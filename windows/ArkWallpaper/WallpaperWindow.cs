using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ArkWallpaper;

internal sealed class WallpaperWindow : Form
{
    private readonly Uri origin;
    private readonly Diagnostics log;
    private WebView2 web = null!;
    private string? diagnosticScript;
    private bool interactive;
    private bool pointerBusy;
    private bool pointerActive;
    private bool suspended;
    private bool ready;
    private bool stopped;
    private ulong navigationId;
    private long updateVersion;
    private WallpaperSettings settings;
    public DisplayInfo Display { get; private set; }
    public int NavigationCount { get; private set; }
    public bool Ready => ready;
    public event Action<WallpaperWindow, WallpaperSettings>? SettingsReceived;
    public event Action<WallpaperWindow, bool>? RecoveryRequested;
    public event Action? PointerRefreshRequested;
    protected override bool ShowWithoutActivation => !interactive;
    protected override CreateParams CreateParams
    {
        get { var p = base.CreateParams; p.ExStyle |= (int)(NativeMethods.WsExToolWindow | NativeMethods.WsExNoActivate); return p; }
    }

    public WallpaperWindow(DisplayInfo display, Uri origin, WallpaperSettings settings, Diagnostics log)
    {
        Display = display; this.origin = origin; this.settings = settings; this.log = log;
        Text = "Ark Wallpaper";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Bounds = display.Bounds;
        BackColor = ColorTranslator.FromHtml(settings.BackgroundColor);
        _ = Handle;
    }

    public async Task InitializeAsync(CoreWebView2Environment environment)
    {
        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        Controls.Add(web);
        await web.EnsureCoreWebView2Async(environment);
        if (stopped) return;
        var core = web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = settings.DiagnosticsEnabled;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        core.Settings.IsSwipeNavigationEnabled = false;
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.NavigationStarting += (_, e) =>
        {
            if (!WallpaperProtocol.SameOrigin(origin, e.Uri)) { e.Cancel = true; log.Event("navigation.blocked"); return; }
            ready = false; NavigationCount++;
            navigationId = e.NavigationId;
            pointerActive = false;
            log.Event("navigation.started");
        };
        core.FrameNavigationStarting += (_, e) => e.Cancel = !WallpaperProtocol.SameOrigin(origin, e.Uri);
        core.NavigationCompleted += async (_, e) =>
        {
            // A canceled external navigation must not mark the existing document unready.
            if (stopped || e.NavigationId != navigationId) return;
            ready = e.IsSuccess;
            log.Event(e.IsSuccess ? "navigation.completed" : "navigation.failed", new { status = e.WebErrorStatus.ToString() });
            if (ready)
            {
                // React's effects can register setters after NavigationCompleted; the URL
                // already carries the initial settings, and the retry delivers edits made in-flight.
                try
                {
                    for (var i = 0; i < 40 && !stopped && e.NavigationId == navigationId; i++)
                    {
                        if (await ExecuteAsync("Boolean(window.__setWallpaperTransform && window.__setWallpaperClock && window.__setWallpaperBackground)") == "true") break;
                        await Task.Delay(50);
                    }
                    if (stopped || e.NavigationId != navigationId) return;
                    await ApplyAsync(settings);
                    PointerRefreshRequested?.Invoke();
                }
                catch (Exception exception) when (exception is InvalidOperationException or System.Runtime.InteropServices.COMException)
                { log.Event("navigation.apply-failed", new { type = exception.GetType().Name }); }
            }
        };
        core.WebMessageReceived += (_, e) => Receive(e.Source, e.WebMessageAsJson);
        core.ProcessFailed += (_, e) =>
        {
            if (stopped) return;
            log.Event("webview.process-failed", new { kind = e.ProcessFailedKind.ToString() });
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.BrowserProcessExited or CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            { ready = false; RecoveryRequested?.Invoke(this, e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited); }
        };
        core.WebResourceResponseReceived += (_, e) =>
        {
            if (e.Response.StatusCode >= 400) log.Event("webview.resource-error", new { status = e.Response.StatusCode });
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(WallpaperProtocol.BridgeScript);
        await SetDiagnosticsAsync(settings.DiagnosticsEnabled);
        core.Navigate(WallpaperProtocol.BuildUri(origin, settings).AbsoluteUri);
        log.Event("window.created", new { Display.Bounds.Width, Display.Bounds.Height, Display.Dpi });
    }

    private void Receive(string source, string json)
    {
        if (stopped || !WallpaperProtocol.SameOrigin(origin, source) || json.Length > 8192) return;
        if (WallpaperProtocol.TryApplyMessage(json, settings, out var updated))
        {
            settings = updated;
            SettingsReceived?.Invoke(this, updated);
            return;
        }
        if (!log.Enabled) return;
        try
        {
            using var d = JsonDocument.Parse(json);
            if (d.RootElement.GetProperty("channel").GetString() != "diagnostic") return;
            var name = d.RootElement.GetProperty("payload").GetString();
            if (new[] { "pageshow", "pagehide", "error", "unhandledrejection", "visibilitychange", "webglcontextlost", "webglcontextrestored" }.Contains(name)) log.Event("page." + name);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException) { }
    }

    public async Task SetDiagnosticsAsync(bool enabled)
    {
        if (stopped || web?.CoreWebView2 is null) return;
        web.CoreWebView2.Settings.AreDevToolsEnabled = enabled;
        if (enabled && diagnosticScript is null)
        {
            diagnosticScript = await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(WallpaperProtocol.DiagnosticsScript);
            await ExecuteAsync(WallpaperProtocol.DiagnosticsScript);
        }
        else if (!enabled && diagnosticScript is not null)
        {
            web.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(diagnosticScript);
            diagnosticScript = null;
            await ExecuteAsync("window.__arkDiagnostics?.();");
        }
    }

    public void Bind(DesktopHost desktop, DisplayInfo display, bool interaction)
    {
        Display = display; interactive = interaction;
        desktop.Attach(Handle, display, interactive);
        // Disabling input on the WebView child prevents it receiving desktop clicks
        // even on systems where WS_EX_TRANSPARENT does not cross thread boundaries.
        if (web is not null) web.Enabled = interaction;
        if (interactive && Visible) Activate();
    }

    public async Task ApplyAsync(WallpaperSettings next)
    {
        if (stopped) return;
        var version = ++updateVersion;
        var modelChanged = settings.ModelID != next.ModelID;
        settings = next;
        BackColor = ColorTranslator.FromHtml(next.BackgroundColor);
        if (stopped || web?.CoreWebView2 is null) return;
        web.DefaultBackgroundColor = BackColor;
        await SetDiagnosticsAsync(next.DiagnosticsEnabled);
        if (stopped || version != updateVersion) return;
        if (modelChanged) web.CoreWebView2.Navigate(WallpaperProtocol.BuildUri(origin, next).AbsoluteUri);
        else if (ready) await ExecuteAsync(WallpaperProtocol.SettingsScript(next));
    }

    public void Reload()
    {
        if (stopped || web?.CoreWebView2 is null) return;
        // Rebuild the URL so a manual reload includes the latest hot-updated settings.
        web.CoreWebView2.Navigate(WallpaperProtocol.BuildUri(origin, settings).AbsoluteUri);
    }

    public async Task SetPausedAsync(bool pause)
    {
        if (stopped || web?.CoreWebView2 is null) return;
        suspended = pause;
        if (pause)
        {
            await SendPointerAsync(false);
            if (stopped || !suspended) return;
            web.Visible = false;
            Hide();
            await Task.Yield();
            if (stopped || !suspended) return;
            log.Event("webview.suspended", new { success = await web.CoreWebView2.TrySuspendAsync() });
        }
        else
        {
            web.CoreWebView2.Resume();
            web.Visible = true;
            Show();
            PointerRefreshRequested?.Invoke();
        }
    }

    public async Task SendPointerAsync(bool enabled)
    {
        if (pointerBusy || stopped || !ready) return;
        pointerBusy = true;
        try
        {
            var point = new NativeMethods.Point();
            var active = enabled && !suspended && NativeMethods.GetCursorPos(out point) && Display.Bounds.Contains(point.X, point.Y);
            if (!active && !pointerActive) return;
            pointerActive = active;
            if (active) NativeMethods.ScreenToClient(web.Handle, ref point);
            // Let the page convert client physical pixels using the renderer's actual
            // devicePixelRatio. This also covers mixed DPI after SetParent.
            var script = active
                ? $"window.__setWallpaperClockPointer?.({{x:{point.X}/window.devicePixelRatio,y:{point.Y}/window.devicePixelRatio,active:true}});"
                : WallpaperProtocol.Call("__setWallpaperClockPointer", new { active = false });
            await ExecuteAsync(script);
        }
        finally { pointerBusy = false; }
    }

    internal async Task<string?> ExecuteAsync(string script)
    {
        if (stopped || web?.CoreWebView2 is null) return null;
        try { return await web.CoreWebView2.ExecuteScriptAsync(script).WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException or ObjectDisposedException or TimeoutException) { log.Event("webview.script-unavailable", new { type = e.GetType().Name }); return null; }
    }

    internal async Task CaptureAsync(string path)
    {
        using var stream = File.Create(path);
        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream).WaitAsync(TimeSpan.FromSeconds(10));
    }

    protected override void WndProc(ref Message m)
    {
        if (!interactive && m.Msg == 0x84) { m.Result = -1; return; } // HTTRANSPARENT
        if (!interactive && m.Msg == 0x21) { m.Result = 3; return; } // MA_NOACTIVATE
        base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing)
    {
        stopped = true;
        if (disposing) { web?.Dispose(); log.Event("window.destroyed"); }
        base.Dispose(disposing);
    }
}
