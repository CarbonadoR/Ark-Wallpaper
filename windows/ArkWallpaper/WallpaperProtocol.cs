using System.Globalization;
using System.Text.Json;

namespace ArkWallpaper;

public static class WallpaperProtocol
{
    public const string BridgeScript = """
        window.webkit ??= {};
        window.webkit.messageHandlers ??= {};
        for (const channel of ["wallpaperTransform", "wallpaperClock"]) {
          window.webkit.messageHandlers[channel] = {
            postMessage(payload) { window.chrome.webview.postMessage({ channel, payload }); }
          };
        }
        """;

    // Only event names cross the diagnostic bridge: never URLs, error text or resource paths.
    public const string DiagnosticsScript = """
        (() => {
          if (window.__arkDiagnostics) return;
          const events = [];
          const on = (target, name) => {
            const handler = () => window.chrome.webview.postMessage({channel:'diagnostic', payload:name});
            target.addEventListener(name, handler, true); events.push([target,name,handler]);
          };
          for (const name of ['pageshow','pagehide','error','unhandledrejection']) on(window,name);
          for (const name of ['visibilitychange','webglcontextlost','webglcontextrestored']) on(document,name);
          window.__arkDiagnostics = () => { for (const [target,name,handler] of events) target.removeEventListener(name,handler,true); delete window.__arkDiagnostics; };
        })();
        """;

    public static bool SameOrigin(Uri origin, string source) => Uri.TryCreate(source, UriKind.Absolute, out var uri)
        && uri.Scheme == origin.Scheme && uri.Host == origin.Host && uri.Port == origin.Port && uri.UserInfo.Length == 0;

    public static void ValidateOrigin(Uri origin)
    {
        if (origin.Scheme != "http" || !origin.IsLoopback || origin.UserInfo.Length != 0 || origin.AbsolutePath != "/" || origin.Query.Length != 0 || origin.Fragment.Length != 0)
            throw new InvalidOperationException("壁纸服务地址必须是 HTTP loopback origin。");
    }

    public static string[] BackgroundImages(WallpaperSettings s)
    {
        var id = s.Normalize().BackgroundImageID;
        if (id.Length == 0) return [];
        var parts = id.Split(':');
        var prefix = $"/api/backgrounds/{Uri.EscapeDataString(parts[0])}/";
        return parts[1] == "hd" ? [prefix + "left", prefix + "right"] : [prefix + "image"];
    }

    public static object Layout(WallpaperSettings s) => new { fit = s.FitMode, scale = s.Scale, offsetX = s.OffsetX, offsetY = s.OffsetY, locked = s.LayoutLocked };
    public static object Clock(WallpaperSettings s) => new { enabled = s.ClockEnabled, theme = s.ClockTheme, scale = s.ClockScale, x = s.ClockX, y = s.ClockY, locked = s.ClockLocked, perspective = s.ClockPerspective, pointerPerspective = s.ClockPointerPerspective };
    public static object Background(WallpaperSettings s) => new { color = s.BackgroundColor, imageUrl = BackgroundImages(s).Length == 1 ? BackgroundImages(s)[0] : "", imageUrls = BackgroundImages(s), spineId = "" };
    public static string Call(string function, object payload) => $"window.{function}?.({JsonSerializer.Serialize(payload)});";
    public static string SettingsScript(WallpaperSettings s) => Call("__setWallpaperTransform", Layout(s)) + Call("__setWallpaperBackground", Background(s)) + Call("__setWallpaperClock", Clock(s));

    public static Uri BuildUri(Uri origin, WallpaperSettings settings)
    {
        ValidateOrigin(origin);
        var s = settings.Normalize();
        var values = new Dictionary<string, string>
        {
            ["wallpaper"] = "1", ["model"] = s.ModelID, ["fit"] = s.FitMode, ["scale"] = Number(s.Scale),
            ["x"] = Number(s.OffsetX), ["y"] = Number(s.OffsetY), ["locked"] = Bit(s.LayoutLocked), ["background"] = s.BackgroundColor,
            ["clock"] = Bit(s.ClockEnabled), ["clockTheme"] = s.ClockTheme, ["clockScale"] = Number(s.ClockScale),
            ["clockX"] = Number(s.ClockX), ["clockY"] = Number(s.ClockY), ["clockLocked"] = Bit(s.ClockLocked),
            ["clockPerspective"] = s.ClockPerspective, ["clockPointerPerspective"] = Bit(s.ClockPointerPerspective)
        };
        var images = BackgroundImages(s);
        if (images.Length == 1) values["backgroundImage"] = images[0];
        if (images.Length == 2) { values["backgroundImageLeft"] = images[0]; values["backgroundImageRight"] = images[1]; }
        return new UriBuilder(origin) { Query = string.Join("&", values.Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}")) }.Uri;
    }

    public static bool TryApplyMessage(string json, WallpaperSettings current, out WallpaperSettings updated)
    {
        updated = current;
        if (json.Length > 8192) return false;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var channel = root.GetProperty("channel").GetString();
            var p = root.GetProperty("payload");
            // Strict types at the native boundary; bounds still match the page.
            updated = channel switch
            {
                "wallpaperTransform" => current with { FitMode = p.GetProperty("fit").GetString()!, Scale = p.GetProperty("scale").GetDouble(), OffsetX = p.GetProperty("offsetX").GetDouble(), OffsetY = p.GetProperty("offsetY").GetDouble(), LayoutLocked = p.GetProperty("locked").GetBoolean() },
                "wallpaperClock" => current with { ClockEnabled = p.GetProperty("enabled").GetBoolean(), ClockTheme = p.GetProperty("theme").GetString()!, ClockScale = p.GetProperty("scale").GetDouble(), ClockX = p.GetProperty("x").GetDouble(), ClockY = p.GetProperty("y").GetDouble(), ClockLocked = p.GetProperty("locked").GetBoolean(), ClockPerspective = p.GetProperty("perspective").GetString()!, ClockPointerPerspective = p.GetProperty("pointerPerspective").GetBoolean() },
                _ => current
            };
            if (channel is not ("wallpaperTransform" or "wallpaperClock")) return false;
            updated = updated.Normalize();
            return true;
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException or FormatException) { return false; }
    }

    private static string Number(double n) => n.ToString(CultureInfo.InvariantCulture);
    private static string Bit(bool b) => b ? "1" : "0";
}
