namespace ArkWallpaper;

internal sealed class PointerTracker(Func<IEnumerable<WallpaperWindow>> windows) : IDisposable
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 23 };
    private bool enabled;
    public void Start() => timer.Tick += Tick;
    private async void Tick(object? sender, EventArgs e)
    {
        foreach (var window in windows().ToArray()) await window.SendPointerAsync(enabled);
    }
    public void Update(bool value)
    {
        enabled = value;
        timer.Enabled = value;
        Tick(null, EventArgs.Empty);
    }
    public void Refresh() => Tick(null, EventArgs.Empty);
    public void Dispose() => timer.Dispose();
}
