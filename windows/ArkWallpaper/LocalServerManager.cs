using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;

namespace ArkWallpaper;

public sealed class LocalServerManager(LaunchConfiguration config, Diagnostics log) : IDisposable
{
    private readonly HttpClient client = new(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(2) };
    private Process? ownedProcess;
    private OwnedProcessJob? ownedJob;
    public bool OwnsServer => ownedProcess is not null;

    public static ProcessStartInfo StartInfo(LaunchConfiguration config)
    {
        // .cmd cannot be launched with UseShellExecute=false. Invoke its npm-cli.js
        // using node + ArgumentList instead, preserving `npm run start` without cmd quoting.
        var info = new ProcessStartInfo(config.NodePath) { WorkingDirectory = config.ProjectRoot, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(config.NpmCliPath);
        info.ArgumentList.Add("run");
        info.ArgumentList.Add("start");
        foreach (var key in info.Environment.Keys.Where(k => k.EndsWith("_proxy", StringComparison.OrdinalIgnoreCase) || k.Equals("proxy", StringComparison.OrdinalIgnoreCase)).ToArray()) info.Environment.Remove(key);
        info.Environment["NO_PROXY"] = "127.0.0.1,localhost,::1";
        info.Environment["ARKNIGHTS_VIEWER_HOST"] = config.Origin.Host;
        info.Environment["ARKNIGHTS_VIEWER_PORT"] = config.Origin.Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return info;
    }

    public async Task<bool> IsHealthyAsync(CancellationToken token)
    {
        try
        {
            using var response = await client.GetAsync(new Uri(config.Origin, "/api/status"), token);
            if (!response.IsSuccessStatusCode) return false;
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
            var root = document.RootElement;
            return root.TryGetProperty("ready", out var ready) && ready.ValueKind == JsonValueKind.True
                && root.TryGetProperty("models", out var models) && models.TryGetInt32(out _)
                && root.TryGetProperty("groups", out var groups) && groups.TryGetInt32(out _);
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or OperationCanceledException) { return false; }
    }

    public async Task EnsureStartedAsync(CancellationToken token)
    {
        log.Event("server.health-check");
        if (await IsHealthyAsync(token)) { log.Event("server.reused"); return; }
        token.ThrowIfCancellationRequested();
        ownedProcess = new Process { StartInfo = StartInfo(config) };
        // Drain output, but do not write server errors containing resource paths to host logs.
        ownedProcess.OutputDataReceived += (_, _) => { };
        ownedProcess.ErrorDataReceived += (_, _) => { };
        ownedJob = new OwnedProcessJob();
        ownedProcess.Start();
        ownedJob.Assign(ownedProcess);
        ownedProcess.BeginOutputReadLine();
        ownedProcess.BeginErrorReadLine();
        log.Event("server.started");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            while (!deadline.IsCancellationRequested)
            {
                if (await IsHealthyAsync(deadline.Token)) { log.Event("server.ready"); return; }
                if (ownedProcess.HasExited) break;
                await Task.Delay(250, deadline.Token);
            }
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { }
        token.ThrowIfCancellationRequested();
        throw new InvalidOperationException("本地服务启动失败。请检查 config/runtime.local.json 的资源目录，并在工程目录运行 npm start 查看错误；确认端口未被占用。");
    }

    public async Task<JsonDocument> GetAsync(string path, CancellationToken token)
    {
        using var response = await client.GetAsync(new Uri(config.Origin, path), token);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
    }

    public void Dispose()
    {
        ownedJob?.Dispose();
        ownedJob = null;
        if (ownedProcess is not null)
        {
            try { if (!ownedProcess.HasExited) ownedProcess.Kill(entireProcessTree: true); }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { log.Event("server.stop-failed"); }
            ownedProcess.Dispose();
            ownedProcess = null;
            log.Event("server.stopped");
        }
        client.Dispose();
    }
}
