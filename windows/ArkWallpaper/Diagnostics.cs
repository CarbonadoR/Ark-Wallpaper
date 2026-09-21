using System.Text.Json;

namespace ArkWallpaper;

public sealed class Diagnostics(string directory)
{
    private readonly object gate = new();
    public bool Enabled { get; set; }
    public string DirectoryPath => Path.Combine(directory, "Logs");
    // Callers supply event codes and numeric/enum data, never exception messages or URLs.
    public void Event(string name, object? data = null)
    {
        if (!Enabled) return;
        lock (gate)
        {
            try
            {
                Directory.CreateDirectory(DirectoryPath);
                var path = Path.Combine(DirectoryPath, "wallpaper.log");
                if (File.Exists(path) && new FileInfo(path).Length >= 4 * 1024 * 1024)
                    File.Move(path, Path.Combine(DirectoryPath, "wallpaper.previous.log"), true);
                File.AppendAllText(path, JsonSerializer.Serialize(new { time = DateTimeOffset.UtcNow, name, data }) + Environment.NewLine);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* Diagnostics must never stop the wallpaper. */ }
        }
    }
}
