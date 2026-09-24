using System.Text.Json;
using System.Net.Http;
using System.Net.Http.Json;

namespace ArkWallpaper;

// Explicit opt-in integration harness. It drives the real HWND/WebView and uses
// isolated settings; reports contain only test names, counts and exception types.
internal static class SmokeTests
{
    public static async Task RunAsync(WallpaperWindow[] windows, DesktopHost desktop, WallpaperSettings original, LocalServerManager server,
        Uri origin, string report, Func<bool, Task> interaction, Func<WallpaperSettings, Task> apply, Func<bool, Task> pause, Func<Task> reconcile, Func<WallpaperSettings> readSettings)
    {
        var checks = new List<string>();
        void Check(bool value, string name) { if (!value) throw new InvalidOperationException("Smoke check failed: " + name); checks.Add(name); }
        Check(windows.Length == DisplayTopology.Read().Count, "one-window-per-display");
        foreach (var window in windows)
        {
            await WaitAsync(async () => window.Ready && await window.ExecuteAsync("Boolean(window.__setWallpaperTransform && window.__setWallpaperClock && document.querySelector('main')?.dataset.loadedModel)") == "true");
            Check(NativeMethods.GetParent(window.Handle) == desktop.Worker, "worker-parent");
            Check(NativeMethods.IsWindowVisible(window.Handle), "native-wallpaper-visible");
            NativeMethods.GetClientRect(window.Handle, out var client);
            Check(client.Rectangle.Size == window.Display.Bounds.Size, "physical-client-matches-monitor");
            using var viewport = JsonDocument.Parse((await window.ExecuteAsync("JSON.stringify({width:innerWidth*devicePixelRatio,height:innerHeight*devicePixelRatio})"))!);
            using var dimensions = JsonDocument.Parse(viewport.RootElement.GetString()!);
            Check(Math.Abs(dimensions.RootElement.GetProperty("width").GetDouble() - client.Rectangle.Width) <= 2
                && Math.Abs(dimensions.RootElement.GetProperty("height").GetDouble() - client.Rectangle.Height) <= 2, "CSS-viewport-matches-physical-client");
            Check((NativeMethods.GetWindowLongPtr(window.Handle, NativeMethods.GwlExStyle).ToInt64() & NativeMethods.WsExNoActivate) != 0, "no-activate");
        }
        var counts = windows.Select(w => w.NavigationCount).ToArray();
        await reconcile();
        Check(windows.Select(w => w.NavigationCount).SequenceEqual(counts), "unchanged-topology-preserves-navigation");
        await interaction(true);
        // GetParent also returns an owner for top-level tool windows. GA_PARENT
        // distinguishes actual parenting from WinForms' hidden taskbar owner.
        Check(windows.All(w => NativeMethods.GetAncestor(w.Handle, 1) == NativeMethods.GetDesktopWindow()), "interactive-detaches-desktop");
        await interaction(false);
        Check(windows.All(w => NativeMethods.GetParent(w.Handle) == desktop.Worker), "interaction-restores-desktop");
        Check(windows.Select(w => w.NavigationCount).SequenceEqual(counts), "interaction-preserves-webview");

        foreach (var fit in WallpaperSettings.Fits) await apply(original with { FitMode = fit, Scale = 1.1, OffsetX = -5, OffsetY = 4 });
        foreach (var theme in WallpaperSettings.Themes)
        {
            await apply(original with { ClockTheme = theme, ClockPerspective = "left", ClockPointerPerspective = true });
            await WaitAsync(async () => await windows[0].ExecuteAsync($"Boolean(document.querySelector('.clock-{theme}.perspective-left.pointer-perspective'))") == "true");
            await windows[0].SendPointerAsync(true);
            Check(true, "clock-theme-" + theme);
        }
        await apply(original with { ClockPerspective = "right", BackgroundColor = "#183044", ClockScale = 1.2 });
        await WaitAsync(async () => await windows[0].ExecuteAsync("Boolean(document.querySelector('.desktop-clock.perspective-right')) && getComputedStyle(document.querySelector('.wallpaper-background')).backgroundColor === 'rgb(24, 48, 68)'") == "true");
        Check(windows.Select(w => w.NavigationCount).SequenceEqual(counts), "appearance-hot-updates-without-navigation");

        using var backgrounds = await server.GetAsync("/api/backgrounds", CancellationToken.None);
        foreach (var mode in new[] { "hd", "blur" })
        {
            var background = backgrounds.RootElement.GetProperty("backgrounds").EnumerateArray().FirstOrDefault(b => b.GetProperty("id").GetString()!.EndsWith(":" + mode, StringComparison.Ordinal));
            if (background.ValueKind == JsonValueKind.Undefined) continue;
            await apply(original with { BackgroundImageID = background.GetProperty("id").GetString()! });
            var expected = mode == "hd" ? 2 : 1;
            await WaitAsync(async () => await windows[0].ExecuteAsync($"document.querySelectorAll('.wallpaper-background img').length === {expected} && [...document.querySelectorAll('.wallpaper-background img')].every(image => image.complete && image.naturalWidth > 0)") == "true");
            Check(true, "background-loaded-" + mode);
        }
        await apply(original with { LayoutLocked = false });
        await windows[0].ExecuteAsync("document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {deltaY:-100, bubbles:true,cancelable:true}));");
        await WaitAsync(() => Task.FromResult(Math.Abs(readSettings().Scale - original.Scale * 1.08) < .001));
        Check(!readSettings().LayoutLocked, "wheel-message-reaches-host");
        var clockMessage = JsonSerializer.Serialize(WallpaperProtocol.Clock(original with { ClockX = 72, ClockY = 30 }));
        await windows[0].ExecuteAsync($"window.webkit.messageHandlers.wallpaperClock.postMessage({clockMessage});");
        await WaitAsync(() => Task.FromResult(readSettings().ClockX == 72 && readSettings().ClockY == 30));
        foreach (var window in windows)
            await WaitAsync(async () => await window.ExecuteAsync("document.querySelector('.desktop-clock').style.left === '72%'") == "true");
        Check(true, "clock-bridge-updates-all-displays");
        await pause(true); Check(windows.All(w => !w.Visible), "pause-hides-windows");
        await pause(false); Check(windows.All(w => w.Visible), "resume-shows-windows");
        Check(windows.Select(w => w.NavigationCount).SequenceEqual(counts), "pause-preserves-navigation");
        var first = windows[0];
        await first.ExecuteAsync("window.__arkSmokeMarker = 1; location.href = 'https://example.invalid/';");
        await Task.Delay(300);
        Check(await first.ExecuteAsync("window.__arkSmokeMarker") == "1", "external-navigation-blocked");
        Check(first.Ready, "blocked-navigation-keeps-document-ready");

        using var catalog = await server.GetAsync("/api/catalog", CancellationToken.None);
        var models = catalog.RootElement.GetProperty("groups").EnumerateArray().SelectMany(g => g.GetProperty("models").EnumerateArray()).ToArray();
        var rendered = new List<string>();
        foreach (var media in new[] { "image", "spine" })
        {
            var model = models.FirstOrDefault(m => m.GetProperty("mediaType").GetString() == media);
            if (model.ValueKind == JsonValueKind.Undefined) continue;
            await apply(original with { ModelID = model.GetProperty("id").GetString()!, FitMode = "contain" });
            var expectedId = JsonSerializer.Serialize(model.GetProperty("id").GetString());
            await WaitAsync(async () => first.Ready && await first.ExecuteAsync($"document.querySelector('main')?.dataset.loadedModel === {expectedId}") == "true");
            await Task.Delay(500);
            Check(await first.ExecuteAsync("!document.querySelector('.error')") == "true", "model-no-error-" + media);
            // Exercise the same save API used by the scene editor, then verify SSE
            // updates every native WebView without navigating or disturbing the model.
            using var scene = await server.GetAsync("/api/models/" + model.GetProperty("id").GetString() + "/scene", CancellationToken.None);
            var sceneAsset = scene.RootElement.GetProperty("assets").EnumerateArray().FirstOrDefault();
            if (sceneAsset.ValueKind != JsonValueKind.Undefined)
            {
                using var http = new HttpClient(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(5) };
                var endpoint = new Uri(origin, "/api/models/" + model.GetProperty("id").GetString() + "/scene");
                var beforeScene = windows.Select(w => w.NavigationCount).ToArray();
                using var saved = await http.PutAsJsonAsync(endpoint, new { revision = scene.RootElement.GetProperty("revision").GetString(),
                    preset = new { layers = new[] { new { id = "smoke-layer", assetId = sceneAsset.GetProperty("id").GetString(), fit = "cover", x = -10, y = 5, scale = 1.2, opacity = .65 } } } });
                saved.EnsureSuccessStatusCode();
                foreach (var window in windows)
                    await WaitAsync(async () => await window.ExecuteAsync("Boolean(document.querySelector('[data-scene-layer=smoke-layer]')) && document.querySelector('[data-scene-layer=smoke-layer]').style.opacity === '0.65' && [...document.querySelectorAll('[data-scene-layer=smoke-layer] img')].every(i => i.complete && i.naturalWidth > 0)") == "true");
                Check(windows.Select(w => w.NavigationCount).SequenceEqual(beforeScene), "scene-sync-without-navigation-" + media);
                Check(await first.ExecuteAsync($"document.querySelector('main')?.dataset.loadedModel === {expectedId}") == "true", "scene-preserves-model-" + media);
            }
            await interaction(true);
            await Task.Delay(300);
            await first.CaptureAsync(Path.Combine(Path.GetDirectoryName(report)!, media + ".png"));
            await interaction(false);
            rendered.Add(media);
        }
        await apply(original);
        var backgroundOptions = backgrounds.RootElement.GetProperty("backgrounds").EnumerateArray()
            .Select(b => new BackgroundOption(b.GetProperty("id").GetString()!, b.GetProperty("name").GetString()!)).ToArray();
        using (var form = new SettingsForm(original, backgroundOptions))
        {
            form.Show();
            await Task.Delay(250);
            Check(form.ClientSize.Width >= 500 * form.DeviceDpi / 96, "settings-DPI-scaled");
            var modelControl = form.Controls.OfType<TabControl>().Single().TabPages[0].Controls.OfType<TableLayoutPanel>().Single().Controls.OfType<TextBox>().Single();
            Check(modelControl.Width >= 200 * form.DeviceDpi / 96, "settings-input-not-clipped");
            using var bitmap = new Bitmap(form.Width, form.Height);
            form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
            bitmap.Save(Path.Combine(Path.GetDirectoryName(report)!, "settings.png"), System.Drawing.Imaging.ImageFormat.Png);
            form.Controls.OfType<TabControl>().Single().SelectedIndex = 1;
            await Task.Delay(100);
            form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
            bitmap.Save(Path.Combine(Path.GetDirectoryName(report)!, "settings-clock.png"), System.Drawing.Imaging.ImageFormat.Png);
        }
        Directory.CreateDirectory(Path.GetDirectoryName(report)!);
        File.WriteAllText(report, JsonSerializer.Serialize(new { passed = true, checks, displays = windows.Select(w => new { w.Display.Bounds.X, w.Display.Bounds.Y, w.Display.Bounds.Width, w.Display.Bounds.Height, w.Display.Dpi }), rendered, serverOwned = server.OwnsServer,
            manualChecks = new[] { "display-hotplug", "Win+D-and-desktop-icons", "actual-Explorer-restart", "physical-sleep-resume", "visual-model-and-clock-interaction", "arm64-runtime" } }, WallpaperSettings.Json));
    }

    private static async Task WaitAsync(Func<Task<bool>> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        while (!await condition()) await Task.Delay(100, timeout.Token);
    }
    public static void WriteFailure(string report, Exception e)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!);
        File.WriteAllText(report, JsonSerializer.Serialize(new { passed = false, error = e.GetType().Name, hresult = e.HResult,
            frames = new System.Diagnostics.StackTrace(e, false).GetFrames().Select(f => f.GetMethod()?.DeclaringType?.Name + "." + f.GetMethod()?.Name),
            check = e.Message.StartsWith("Smoke check failed:", StringComparison.Ordinal) ? e.Message : "startup-or-timeout" }, WallpaperSettings.Json));
    }
}
