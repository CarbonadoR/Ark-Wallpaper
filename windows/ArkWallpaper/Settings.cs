using System.Text.Json;
using System.Text.RegularExpressions;

namespace ArkWallpaper;

// Persisted names match macOS UserDefaults; the page protocol is mapped separately.
public sealed record WallpaperSettings
{
    public string ModelID { get; init; } = "";
    public string FitMode { get; init; } = "cover";
    public double Scale { get; init; } = 1;
    public double OffsetX { get; init; }
    public double OffsetY { get; init; }
    public bool LayoutLocked { get; init; } = true;
    public string BackgroundColor { get; init; } = "#000000";
    public string BackgroundImageID { get; init; } = "";
    public bool ClockEnabled { get; init; } = true;
    public string ClockTheme { get; init; } = "rhodes";
    public double ClockScale { get; init; } = 1;
    public double ClockX { get; init; } = 82;
    public double ClockY { get; init; } = 18;
    public bool ClockLocked { get; init; } = true;
    public string ClockPerspective { get; init; } = "none";
    public bool ClockPointerPerspective { get; init; }
    public bool DiagnosticsEnabled { get; init; }

    public static readonly string[] Fits = ["contain", "cover", "width", "height", "stretch"];
    public static readonly string[] Themes = ["rhodes", "lonetrail", "rainbowsix", "volcano", "monochrome"];
    public static readonly string[] Perspectives = ["none", "left", "right"];
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    public static double Bounded(double value, double fallback, double min, double max) => double.IsFinite(value) ? Math.Clamp(value, min, max) : fallback;
    public static bool ValidModel(string? value) => Regex.IsMatch(value ?? "", "^[a-fA-F0-9]{16}$");

    public WallpaperSettings Normalize()
    {
        var hex = (BackgroundColor ?? "").Trim().TrimStart('#');
        if (Regex.IsMatch(hex, "^[0-9a-fA-F]{3}$")) hex = string.Concat(hex.Select(c => new string(c, 2)));
        return this with
        {
            ModelID = ValidModel(ModelID) ? ModelID.ToLowerInvariant() : "",
            FitMode = Fits.Contains(FitMode) ? FitMode : "cover",
            Scale = Bounded(Scale, 1, .25, 3), OffsetX = Bounded(OffsetX, 0, -100, 100), OffsetY = Bounded(OffsetY, 0, -100, 100),
            BackgroundColor = Regex.IsMatch(hex, "^[0-9a-fA-F]{6}$") ? "#" + hex.ToUpperInvariant() : "#000000",
            BackgroundImageID = Regex.IsMatch(BackgroundImageID ?? "", "^[a-zA-Z0-9_-]+:(hd|blur)$") ? BackgroundImageID! : "",
            ClockTheme = Themes.Contains(ClockTheme) ? ClockTheme : "rhodes",
            ClockScale = Bounded(ClockScale, 1, .5, 2), ClockX = Bounded(ClockX, 82, 4, 96), ClockY = Bounded(ClockY, 18, 6, 94),
            ClockPerspective = Perspectives.Contains(ClockPerspective) ? ClockPerspective : "none"
        };
    }
}

public sealed class SettingsStore(string directory)
{
    public static string DefaultDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Ark-Wallpaper");
    public bool Recovered { get; private set; }
    public WallpaperSettings Load()
    {
        foreach (var name in new[] { "settings.json", "settings.previous.json" })
        {
            try
            {
                var path = Path.Combine(directory, name);
                if (!File.Exists(path)) continue;
                return (JsonSerializer.Deserialize<WallpaperSettings>(File.ReadAllText(path), WallpaperSettings.Json) ?? throw new JsonException()).Normalize();
            }
            catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { Recovered = true; }
        }
        return new();
    }

    public void Save(WallpaperSettings settings)
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "settings.json");
        var temporary = Path.Combine(directory, "settings.tmp");
        using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(stream, settings.Normalize(), WallpaperSettings.Json);
            stream.Flush(true);
        }
        if (File.Exists(path)) File.Replace(temporary, path, Path.Combine(directory, "settings.previous.json"));
        else File.Move(temporary, path);
    }
}
