using System.Runtime.InteropServices;

namespace ArkWallpaper;

public sealed record DisplayInfo(string Device, Rectangle Bounds, uint Dpi)
{
    public string Signature => $"{Device}:{Bounds.X},{Bounds.Y},{Bounds.Width},{Bounds.Height}:{Dpi}";
}

internal static class DisplayTopology
{
    public static IReadOnlyList<DisplayInfo> Read()
    {
        var displays = new List<DisplayInfo>();
        NativeMethods.EnumDisplayMonitors(0, 0, (nint monitor, nint hdc, ref NativeMethods.Rect rect, nint data) =>
        {
            var info = new NativeMethods.MonitorInfo { Size = Marshal.SizeOf<NativeMethods.MonitorInfo>(), Device = "" };
            if (NativeMethods.GetMonitorInfo(monitor, ref info))
            {
                if (NativeMethods.GetDpiForMonitor(monitor, 0, out var dpi, out _) != 0) dpi = 96;
                displays.Add(new DisplayInfo(info.Device, info.Monitor.Rectangle, dpi));
            }
            return true;
        }, 0);
        return displays.OrderBy(d => d.Device, StringComparer.Ordinal).ToArray();
    }
    public static string Signature(IEnumerable<DisplayInfo> displays) => string.Join(";", displays.OrderBy(d => d.Device, StringComparer.Ordinal).Select(d => d.Signature));
}
