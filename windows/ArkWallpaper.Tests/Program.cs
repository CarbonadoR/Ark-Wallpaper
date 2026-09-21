using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using ArkWallpaper;

var passed = 0;
void Check(bool valid, string name) { if (!valid) throw new Exception(name); Console.WriteLine("PASS " + name); passed++; }
var defaults = new WallpaperSettings();
var normalized = (defaults with { ModelID = "bad", FitMode = "invalid", Scale = double.NaN, OffsetX = -999, OffsetY = 999, ClockScale = 20, ClockX = -10, ClockY = double.PositiveInfinity, BackgroundColor = "#abc", BackgroundImageID = "../../secret:hd" }).Normalize();
Check(normalized.ModelID == "" && normalized.FitMode == "cover" && normalized.Scale == 1, "invalid model/fit/non-finite values fall back");
Check(normalized.OffsetX == -100 && normalized.OffsetY == 100 && normalized.ClockScale == 2 && normalized.ClockX == 4 && normalized.ClockY == 18, "layout and clock bounds");
Check(normalized.BackgroundColor == "#AABBCC" && normalized.BackgroundImageID == "", "background normalization rejects path traversal");
var origin = new Uri("http://127.0.0.1:8791");
Check(WallpaperProtocol.SameOrigin(origin, "http://127.0.0.1:8791/?wallpaper=1") && !WallpaperProtocol.SameOrigin(origin, "http://127.0.0.1:8792/") && !WallpaperProtocol.SameOrigin(origin, "http://127.0.0.1.evil.invalid:8791/") && !WallpaperProtocol.SameOrigin(origin, "file:///test"), "navigation and bridge require exact origin");
var rejected = false;
try { WallpaperProtocol.ValidateOrigin(new Uri("https://example.invalid")); } catch (InvalidOperationException) { rejected = true; }
Check(rejected, "only HTTP loopback origins allowed");
var previousCulture = CultureInfo.CurrentCulture;
CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");
var url = WallpaperProtocol.BuildUri(origin, defaults with { Scale = 1.25, BackgroundImageID = "test:hd", ClockPerspective = "right" }).AbsoluteUri;
Check(url.Contains("scale=1.25") && url.Contains("backgroundImageLeft=") && url.Contains("backgroundImageRight=") && url.Contains("clockPerspective=right"), "locale-independent full wallpaper URL");
CultureInfo.CurrentCulture = previousCulture;
Check(WallpaperProtocol.BackgroundImages(defaults with { BackgroundImageID = "test:blur" }).SequenceEqual(new[] { "/api/backgrounds/test/image" }), "blur background resolves to a single local image");
var message = """{"channel":"wallpaperTransform","payload":{"fit":"stretch","scale":20,"offsetX":-500,"offsetY":4,"locked":false}}""";
Check(WallpaperProtocol.TryApplyMessage(message, defaults, out var updated) && updated.Scale == 3 && updated.OffsetX == -100 && updated.FitMode == "stretch" && !updated.LayoutLocked && updated.ClockEnabled, "bridge clamps layout while preserving unrelated settings");
Check(!WallpaperProtocol.TryApplyMessage("""{"channel":"wallpaperTransform","payload":{"scale":"NaN"}}""", defaults, out _) && !WallpaperProtocol.TryApplyMessage("[]", defaults, out _) && !WallpaperProtocol.TryApplyMessage("null", defaults, out _) && !WallpaperProtocol.TryApplyMessage(new string(' ', 8193), defaults, out _), "malformed, wrong-type and oversized bridge messages rejected");
message = """{"channel":"wallpaperClock","payload":{"enabled":true,"theme":"volcano","scale":0.1,"x":100,"y":-20,"locked":false,"perspective":"right","pointerPerspective":true}}""";
Check(WallpaperProtocol.TryApplyMessage(message, defaults, out updated) && updated.ClockScale == .5 && updated.ClockX == 96 && updated.ClockY == 6 && updated.ClockPointerPerspective && updated.ClockPerspective == "right", "clock message contract and bounds");
var directory = Path.Combine(Path.GetTempPath(), "ark-wallpaper-tests-" + Guid.NewGuid().ToString("N"));
try
{
    var store = new SettingsStore(directory);
    Check(store.Load() == defaults, "missing settings use safe defaults");
    store.Save(defaults with { ModelID = "0123456789abcdef", ClockTheme = "lonetrail" });
    store.Save(defaults with { Scale = 1.5 });
    Check(store.Load().Scale == 1.5, "atomic settings round trip");
    File.WriteAllText(Path.Combine(directory, "settings.json"), "{broken");
    Check(store.Load().ClockTheme == "lonetrail" && store.Recovered, "corrupt settings recover previous version");
    var log = new Diagnostics(directory);
    log.Event("test.disabled");
    Check(!Directory.Exists(log.DirectoryPath), "diagnostics off creates no log directory");
    log.Enabled = true; log.Event("test.enabled");
    var logPath = Path.Combine(log.DirectoryPath, "wallpaper.log");
    File.WriteAllText(logPath, new string('x', 4 * 1024 * 1024)); log.Event("test.rotation");
    Check(File.Exists(Path.Combine(log.DirectoryPath, "wallpaper.previous.log")) && new FileInfo(logPath).Length < 1024, "logs rotate at four MiB");

    var config = new LaunchConfiguration("project with spaces & symbols", "node", "npm cli.js", origin.AbsoluteUri);
    var start = LocalServerManager.StartInfo(config);
    Check(!start.UseShellExecute && start.CreateNoWindow && start.Arguments == "" && start.ArgumentList.SequenceEqual(new[] { "npm cli.js", "run", "start" }), "server launch uses argument array without shell interpolation");
    Check(start.Environment["NO_PROXY"] == "127.0.0.1,localhost,::1" && start.Environment.Keys.All(k => !k.EndsWith("_proxy", StringComparison.OrdinalIgnoreCase) || k.Equals("NO_PROXY", StringComparison.OrdinalIgnoreCase)), "child environment bypasses loopback proxies");

    var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    using var cancellation = new CancellationTokenSource();
    var requests = 0;
    var serving = Task.Run(async () =>
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                using var socket = await listener.AcceptTcpClientAsync(cancellation.Token);
                await using var stream = socket.GetStream();
                var buffer = new byte[4096]; await stream.ReadAsync(buffer, cancellation.Token);
                var body = "{\"ready\":true,\"models\":1,\"groups\":1}";
                var response = Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n{body}");
                await stream.WriteAsync(response, cancellation.Token); Interlocked.Increment(ref requests);
            }
        }
        catch (OperationCanceledException) { }
    });
    using (var server = new LocalServerManager(config with { ServerUrl = $"http://127.0.0.1:{port}" }, log))
    {
        await server.EnsureStartedAsync(CancellationToken.None);
        Check(!server.OwnsServer, "healthy existing server reused without starting a process");
    }
    using (var client = new HttpClient(new HttpClientHandler { UseProxy = false }))
        Check((await client.GetAsync($"http://127.0.0.1:{port}/api/status")).IsSuccessStatusCode && requests >= 2, "disposing reused server leaves it running");
    cancellation.Cancel(); listener.Stop(); await serving;
}
finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

var displays = new[] { new DisplayInfo("B", new Rectangle(-1920, -300, 1920, 1080), 144), new DisplayInfo("A", new Rectangle(0, 0, 2560, 1440), 96) };
Check(DisplayTopology.Signature(displays) == DisplayTopology.Signature(displays.Reverse()), "display order does not trigger rebuilds");
Check(DisplayTopology.Signature(displays) != DisplayTopology.Signature(new[] { displays[0] with { Dpi = 192 }, displays[1] }), "DPI change alters topology signature");
Check(displays[0].Bounds.Contains(-100, -100), "negative monitor coordinates preserved");
Console.WriteLine($"{passed} Windows host checks passed.");
