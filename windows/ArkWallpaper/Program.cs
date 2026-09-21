namespace ArkWallpaper;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var smoke = Value(args, "--smoke-report");
        using var singleton = new Mutex(true, smoke is null ? "Local\\ArkWallpaper.DesktopHost" : "Local\\ArkWallpaper.SmokeHost", out var first);
        if (!first) { if (smoke is null) MessageBox.Show("Ark Wallpaper 已在运行，请使用系统托盘菜单。", "Ark Wallpaper"); Environment.ExitCode = 1; return; }
        try
        {
            var configuration = LaunchConfiguration.Load(Value(args, "--config"));
            var directory = smoke is null ? SettingsStore.DefaultDirectory : Path.Combine(Path.GetDirectoryName(Path.GetFullPath(smoke))!, "smoke-user-data");
            using var application = new TrayApplication(configuration, directory, smoke);
            Application.Run(application);
        }
        catch (Exception e)
        {
            Environment.ExitCode = 1;
            if (smoke is not null) SmokeTests.WriteFailure(smoke, e);
            else MessageBox.Show(e is InvalidOperationException ? e.Message : "启动配置读取失败，请重新运行 npm run windows:build。", "Ark Wallpaper", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
    private static string? Value(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
