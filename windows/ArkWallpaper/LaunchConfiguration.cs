using System.Text.Json;

namespace ArkWallpaper;

public sealed record LaunchConfiguration(string ProjectRoot, string NodePath, string NpmCliPath, string ServerUrl)
{
    public Uri Origin => new(ServerUrl);
    public static LaunchConfiguration Load(string? path = null)
    {
        path ??= Path.Combine(AppContext.BaseDirectory, "launch.local.json");
        if (!File.Exists(path)) throw new InvalidOperationException("缺少启动配置，请在工程目录运行 npm run windows:build。");
        var config = JsonSerializer.Deserialize<LaunchConfiguration>(File.ReadAllText(path), WallpaperSettings.Json)
            ?? throw new InvalidOperationException("启动配置无效，请重新构建 Windows 应用。");
        WallpaperProtocol.ValidateOrigin(config.Origin);
        if (!File.Exists(Path.Combine(config.ProjectRoot, "server", "index.mjs")) || !File.Exists(config.NodePath) || !File.Exists(config.NpmCliPath))
            throw new InvalidOperationException("工程或 Node/npm 已移动，请安装 Node.js 后重新运行 npm run windows:build。");
        if (!File.Exists(Path.Combine(config.ProjectRoot, "dist", "index.html")))
            throw new InvalidOperationException("缺少前端文件，请先运行 npm run build。");
        return config;
    }
}
