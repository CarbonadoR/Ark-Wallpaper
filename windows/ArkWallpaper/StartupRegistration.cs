using Microsoft.Win32;

namespace ArkWallpaper;

public sealed class StartupRegistration(string executablePath, string configurationPath,
    string registryPath = @"Software\Microsoft\Windows\CurrentVersion\Run")
{
    private const string ValueName = "ArkWallpaper";

    public string Command => BuildCommand(executablePath, configurationPath);

    public bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(registryPath);
            return string.Equals(key?.GetValue(ValueName) as string, Command, StringComparison.OrdinalIgnoreCase);
        }
    }

    public void SetEnabled(bool enabled)
    {
        if (enabled)
        {
            var command = Command;
            // Windows limits Run entries to a command line of 260 characters.
            if (command.Length > 260)
                throw new InvalidOperationException("启动路径过长，请将应用移至更短的路径后重新开启自启动。");
            if (!File.Exists(executablePath) || !File.Exists(configurationPath))
                throw new InvalidOperationException("启动文件或配置不存在，请重新启动应用后设置自启动。");
            using var key = Registry.CurrentUser.CreateSubKey(registryPath, writable: true);
            key.SetValue(ValueName, command, RegistryValueKind.String);
        }
        else
        {
            using var key = Registry.CurrentUser.OpenSubKey(registryPath, writable: true);
            key?.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }

    public static string BuildCommand(string executablePath, string configurationPath)
    {
        static string Quote(string value)
        {
            if (!Path.IsPathFullyQualified(value) || value.IndexOfAny(['"', '\r', '\n']) >= 0)
                throw new InvalidOperationException("自启动需要有效的绝对文件路径。");
            return "\"" + value + "\"";
        }
        return Quote(executablePath) + " --config " + Quote(configurationPath);
    }
}
