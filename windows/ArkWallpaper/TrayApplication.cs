using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace ArkWallpaper;

internal sealed class TrayApplication : ApplicationContext
{
    private readonly LaunchConfiguration config;
    private readonly SettingsStore store;
    private readonly Diagnostics log;
    private readonly LocalServerManager server;
    private readonly DesktopHost desktop;
    private readonly MessageWindow messages = new();
    private readonly NotifyIcon tray;
    private readonly StartupRegistration startup;
    private readonly ToolStripMenuItem startupItem = new("开机自启动（登录时）");
    private readonly ToolStripMenuItem interactionItem = new("交互模式"), pauseItem = new("暂停壁纸"), diagnosticsItem = new("诊断日志");
    private readonly Dictionary<string, WallpaperWindow> windows = new(StringComparer.Ordinal);
    private readonly PointerTracker pointer;
    private readonly System.Windows.Forms.Timer topologyTimer = new() { Interval = 2000 };
    private readonly System.Windows.Forms.Timer saveTimer = new() { Interval = 300 };
    private readonly CancellationTokenSource lifetime = new();
    private readonly string dataDirectory;
    private readonly string? smokeReport;
    private WallpaperSettings settings;
    private CoreWebView2Environment? environment;
    private SettingsForm? settingsForm;
    private string topology = "";
    private bool initialized, reconciling, exiting, interactive, paused, sleeping, locked, dirty, forceRebind;
    private bool browserRecoveryPending;
    private readonly Dictionary<string, DateTime> rendererRecoveryPending = new(StringComparer.Ordinal);
    private DateTime nextRecovery = DateTime.MinValue;

    public TrayApplication(LaunchConfiguration config, string dataDirectory, string? smokeReport, string configurationPath)
    {
        this.config = config; this.dataDirectory = dataDirectory; this.smokeReport = smokeReport;
        startup = new StartupRegistration(Environment.ProcessPath!, configurationPath);
        store = new SettingsStore(dataDirectory); settings = store.Load();
        log = new Diagnostics(dataDirectory) { Enabled = settings.DiagnosticsEnabled };
        server = new LocalServerManager(config, log); desktop = new DesktopHost(log);
        pointer = new PointerTracker(() => windows.Values); pointer.Start();
        var menu = new ContextMenuStrip();
        menu.Items.Add("壁纸设置…", null, async (_, _) => await GuardAsync(OpenSettingsAsync));
        menu.Items.Add(interactionItem); menu.Items.Add(pauseItem);
        menu.Items.Add("重新加载壁纸", null, (_, _) => { log.Event("wallpaper.reload"); foreach (var window in windows.Values) window.Reload(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("打开查看器", null, (_, _) => Open(config.Origin.AbsoluteUri));
        menu.Items.Add("编辑当前模型场景…", null, (_, _) => Open(new UriBuilder(config.Origin) { Query = "sceneEditor=1&model=" + Uri.EscapeDataString(settings.ModelID) }.Uri.AbsoluteUri));
        menu.Items.Add("显示工程", null, (_, _) => Open(config.ProjectRoot));
        menu.Items.Add(startupItem);
        menu.Items.Add(diagnosticsItem);
        menu.Items.Add("打开日志目录", null, (_, _) => { Directory.CreateDirectory(log.DirectoryPath); Open(log.DirectoryPath); });
        menu.Items.Add(new ToolStripSeparator()); menu.Items.Add("退出", null, (_, _) => ExitThread());
        tray = new NotifyIcon { Text = "Ark Wallpaper · 正在启动", Icon = SystemIcons.Application, ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += async (_, _) => await GuardAsync(OpenSettingsAsync);
        startupItem.Enabled = smokeReport is null;
        startupItem.ToolTipText = "当前用户登录后启动，无需管理员权限；移动应用后请重新开启。若被系统禁用，请在 Windows 启动应用设置中启用。";
        menu.Opening += (_, _) => RefreshStartup();
        startupItem.Click += (_, _) =>
        {
            try
            {
                startup.SetEnabled(!startup.IsEnabled);
                RefreshStartup();
                log.Event("startup.changed", new { enabled = startupItem.Checked });
            }
            catch (Exception e)
            {
                RefreshStartup();
                log.Event("startup.change-failed", new { type = e.GetType().Name });
                Notify(e is InvalidOperationException ? e.Message : "无法修改开机自启动，请检查当前用户的注册表权限。");
            }
        };
        interactionItem.Click += async (_, _) => await GuardAsync(() => SetInteractiveAsync(!interactive));
        pauseItem.Click += async (_, _) => await GuardAsync(async () => { paused = !paused; pauseItem.Checked = paused; pauseItem.Text = paused ? "继续壁纸" : "暂停壁纸"; await UpdateActivityAsync(); });
        diagnosticsItem.Checked = settings.DiagnosticsEnabled;
        diagnosticsItem.Click += async (_, _) => await GuardAsync(() => ApplySettingsAsync(settings with { DiagnosticsEnabled = !settings.DiagnosticsEnabled }));
        messages.DesktopChanged += () => { log.Event("desktop.explorer-restarted"); forceRebind = true; tray.Visible = false; tray.Visible = true; _ = GuardAsync(ReconcileAsync); };
        messages.DisplaysChanged += () => { log.Event("display.notification"); _ = GuardAsync(ReconcileAsync); };
        messages.SleepingChanged += value => { sleeping = value; log.Event("power.changed", new { sleeping }); _ = GuardAsync(UpdateActivityAsync); };
        messages.SessionLockedChanged += value => { locked = value; log.Event("session.changed", new { locked }); _ = GuardAsync(UpdateActivityAsync); };
        topologyTimer.Tick += async (_, _) =>
        {
            if (DateTime.UtcNow < nextRecovery) return;
            try { await ReconcileAsync(); }
            catch (Exception e) { log.Event("desktop.recovery-failed", new { type = e.GetType().Name }); nextRecovery = DateTime.UtcNow.AddSeconds(5); }
        };
        saveTimer.Tick += (_, _) => FlushSettings();
        messages.BeginInvoke(async () => await StartAsync());
    }

    private async Task StartAsync()
    {
        try
        {
            log.Event("application.started");
            await server.EnsureStartedAsync(lifetime.Token);
            await desktop.WaitUntilReadyAsync(lifetime.Token);
            if (exiting) return;
            environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDirectory, "WebView2"), new CoreWebView2EnvironmentOptions("--no-proxy-server"));
            if (exiting) return;
            initialized = true;
            await ReconcileAsync();
            topologyTimer.Start();
            tray.Text = "Ark Wallpaper";
            if (store.Recovered) Notify("设置文件损坏，已尝试从备份恢复。请检查壁纸设置。");
            if (smokeReport is not null)
            {
                await SmokeTests.RunAsync(windows.Values.ToArray(), desktop, settings, server, config.Origin, smokeReport,
                    SetInteractiveAsync, ApplySettingsAsync, async p => { paused = p; await UpdateActivityAsync(); }, ReconcileAsync, () => settings);
                ExitThread();
            }
        }
        catch (OperationCanceledException) when (exiting) { }
        catch (Exception e)
        {
            log.Event("application.start-failed", new { type = e.GetType().Name });
            if (smokeReport is not null) { SmokeTests.WriteFailure(smokeReport, e); Environment.ExitCode = 1; }
            else MessageBox.Show(e is InvalidOperationException ? e.Message : "Windows 壁纸启动失败。请确认已安装 Microsoft Edge WebView2 Runtime，并重新运行 npm run windows:build。", "Ark Wallpaper", MessageBoxButtons.OK, MessageBoxIcon.Error);
            ExitThread();
        }
    }

    private async Task ReconcileAsync()
    {
        if (!initialized || exiting || reconciling) return;
        reconciling = true;
        try
        {
            var displays = DisplayTopology.Read();
            if (displays.Count == 0) return; // Transient during sleep/display negotiation.
            if (browserRecoveryPending)
            {
                // Browser-process loss invalidates every controller in this environment.
                // Release all affected views before creating a replacement environment.
                foreach (var failed in windows.Values) failed.Dispose();
                windows.Clear(); rendererRecoveryPending.Clear(); topology = "";
                environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDirectory, "WebView2"), new CoreWebView2EnvironmentOptions("--no-proxy-server"));
                browserRecoveryPending = false;
                if (exiting) return;
            }
            foreach (var (device, deadline) in rendererRecoveryPending.ToArray())
            {
                if (DateTime.UtcNow < deadline) continue;
                rendererRecoveryPending.Remove(device);
                if (windows.TryGetValue(device, out var failed) && !failed.IsDisposed)
                {
                    try { failed.Reload(); }
                    catch { rendererRecoveryPending[device] = DateTime.UtcNow.AddSeconds(5); }
                }
            }
            var signature = DisplayTopology.Signature(displays);
            var rebind = forceRebind || !desktop.IsValid;
            if (!rebind && topology == signature && windows.Count == displays.Count
                && windows.Values.All(w => !w.IsDisposed && w.IsHandleCreated && NativeMethods.IsWindow(w.Handle))) return;
            if (rebind) desktop.FindWorker();
            log.Event("display.topology", new { count = displays.Count, rebind });
            foreach (var key in windows.Keys.Where(key => !displays.Any(d => d.Device == key)).ToArray())
            { windows[key].Dispose(); windows.Remove(key); }
            foreach (var display in displays)
            {
                if (exiting) return;
                if (windows.TryGetValue(display.Device, out var existing) && (existing.IsDisposed || !existing.IsHandleCreated || !NativeMethods.IsWindow(existing.Handle)))
                { existing.Dispose(); windows.Remove(display.Device); }
                if (!windows.TryGetValue(display.Device, out var window))
                {
                    window = new WallpaperWindow(display, config.Origin, settings, log);
                    windows.Add(display.Device, window);
                    window.SettingsReceived += (source, value) => { settings = value; dirty = true; saveTimer.Stop(); saveTimer.Start(); settingsForm?.Synchronize(value); pointer.Update(PointerEnabled); _ = GuardAsync(() => BroadcastAsync(value)); };
                    window.PointerRefreshRequested += pointer.Refresh;
                    window.RecoveryRequested += (failed, recreate) =>
                    {
                        messages.BeginInvoke(async () => await GuardAsync(async () =>
                        {
                            if (exiting || failed.IsDisposed) return;
                            if (recreate) { browserRecoveryPending = true; await ReconcileAsync(); }
                            else rendererRecoveryPending[failed.Display.Device] = DateTime.UtcNow.AddSeconds(2);
                        }));
                    };
                    try { await window.InitializeAsync(environment!); }
                    catch { windows.Remove(display.Device); window.Dispose(); throw; }
                    if (exiting) return;
                    window.Bind(desktop, display, interactive);
                    await window.SetPausedAsync(Inactive);
                }
                else if (rebind || window.Display.Signature != display.Signature) window.Bind(desktop, display, interactive);
            }
            topology = signature; forceRebind = false; pointer.Update(PointerEnabled);
        }
        finally { reconciling = false; }
    }

    private bool Inactive => paused || sleeping || locked;
    private bool PointerEnabled => settings.ClockEnabled && settings.ClockPointerPerspective && !Inactive && !exiting;

    private Task SetInteractiveAsync(bool value)
    {
        if (value && Inactive) { Notify("请先继续壁纸，再开启交互模式。"); return Task.CompletedTask; }
        try
        {
            foreach (var window in windows.Values) window.Bind(desktop, window.Display, value);
        }
        catch
        {
            // A partial transition must never leave an input-enabled window over icons.
            interactive = false; interactionItem.Checked = false; forceRebind = true;
            foreach (var window in windows.Values)
            {
                try { window.Bind(desktop, window.Display, false); }
                catch { window.Hide(); }
            }
            throw;
        }
        interactive = value; interactionItem.Checked = value; log.Event("interaction.changed", new { interactive });
        return Task.CompletedTask;
    }

    private async Task UpdateActivityAsync()
    {
        pointer.Update(false);
        if (Inactive && interactive) await SetInteractiveAsync(false);
        foreach (var window in windows.Values.ToArray()) await window.SetPausedAsync(Inactive);
        if (!Inactive) { forceRebind = true; await ReconcileAsync(); }
        pointer.Update(PointerEnabled); log.Event("wallpaper.activity", new { paused, sleeping, locked });
    }

    private async Task ApplySettingsAsync(WallpaperSettings value)
    {
        settings = value.Normalize(); dirty = true; FlushSettings();
        log.Enabled = settings.DiagnosticsEnabled; diagnosticsItem.Checked = log.Enabled;
        log.Event("settings.changed");
        await BroadcastAsync(settings); pointer.Update(PointerEnabled);
    }
    private async Task BroadcastAsync(WallpaperSettings value)
    {
        foreach (var window in windows.Values.ToArray())
        {
            if (exiting || settings != value) return;
            await window.ApplyAsync(value);
        }
    }
    private void FlushSettings()
    {
        saveTimer.Stop();
        if (!dirty) return;
        try { store.Save(settings); dirty = false; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { log.Event("settings.save-failed"); if (!exiting) Notify("无法保存设置，请检查本地应用数据目录的写入权限。当前设置仍生效。"); }
    }
    private async Task OpenSettingsAsync()
    {
        if (!initialized) { Notify("正在启动壁纸，请稍候。"); return; }
        if (settingsForm is { IsDisposed: false }) { settingsForm.Activate(); return; }
        var backgrounds = new List<BackgroundOption>();
        try
        {
            using var data = await server.GetAsync("/api/backgrounds", lifetime.Token);
            foreach (var item in data.RootElement.GetProperty("backgrounds").EnumerateArray())
                backgrounds.Add(new BackgroundOption(item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!));
        }
        catch (Exception e) when (e is System.Net.Http.HttpRequestException or System.Text.Json.JsonException or OperationCanceledException) { Notify("背景目录暂时无法读取，仍可调整其他设置。"); }
        if (exiting) return;
        settingsForm = new SettingsForm(settings, backgrounds);
        settingsForm.Applied += async value => await GuardAsync(() => ApplySettingsAsync(value with { DiagnosticsEnabled = settings.DiagnosticsEnabled }));
        settingsForm.Show();
    }
    private async Task GuardAsync(Func<Task> action)
    {
        if (exiting) return;
        try { await action(); }
        catch (Exception e) { log.Event("application.operation-failed", new { type = e.GetType().Name }); if (!exiting) Notify("操作未完成。请检查服务状态；桌面恢复失败时会自动重试，可开启诊断查看事件。"); }
    }
    private void Notify(string text) => tray.ShowBalloonTip(5000, "Ark Wallpaper", text, ToolTipIcon.Info);
    private void RefreshStartup()
    {
        if (smokeReport is not null) return;
        try { startupItem.Checked = startup.IsEnabled; startupItem.Enabled = true; }
        catch (Exception e)
        {
            startupItem.Checked = false; startupItem.Enabled = false;
            log.Event("startup.read-failed", new { type = e.GetType().Name });
        }
    }
    private void Open(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
        catch (Exception e) { log.Event("shell.open-failed", new { type = e.GetType().Name }); Notify("无法打开所选位置。"); }
    }

    protected override void ExitThreadCore()
    {
        if (exiting) return;
        exiting = true; lifetime.Cancel(); topologyTimer.Stop(); saveTimer.Stop(); pointer.Dispose();
        FlushSettings(); settingsForm?.Dispose();
        foreach (var window in windows.Values) window.Dispose();
        windows.Clear(); server.Dispose(); log.Event("application.stopped");
        tray.Visible = false; tray.Dispose(); messages.Dispose();
        topologyTimer.Dispose(); saveTimer.Dispose(); lifetime.Dispose();
        base.ExitThreadCore();
    }
}
