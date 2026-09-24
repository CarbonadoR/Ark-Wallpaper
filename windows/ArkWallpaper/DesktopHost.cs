using System.ComponentModel;
using System.Runtime.InteropServices;

namespace ArkWallpaper;

internal sealed class DesktopHost(Diagnostics log)
{
    public nint Worker { get; private set; }
    public bool IsValid => Worker != 0 && NativeMethods.IsWindow(Worker);
    public async Task WaitUntilReadyAsync(CancellationToken token)
    {
        // Explorer may still be creating its desktop when a logon entry runs.
        for (var attempt = 0; ; attempt++)
        {
            token.ThrowIfCancellationRequested();
            try { FindWorker(); return; }
            catch (InvalidOperationException) when (attempt < 29)
            {
                log.Event("desktop.waiting-for-explorer");
                await Task.Delay(1000, token);
            }
        }
    }
    public void FindWorker()
    {
        Worker = 0;
        var progman = NativeMethods.FindWindow("Progman", null);
        if (progman == 0) throw new InvalidOperationException("无法找到 Windows 桌面，请等待资源管理器启动后重试。");
        NativeMethods.SendMessageTimeout(progman, 0x052c, 0xd, 0, 2, 1000, out _);
        NativeMethods.SendMessageTimeout(progman, 0x052c, 0xd, 1, 2, 1000, out _);
        // Windows 11's raised desktop hosts WorkerW under Progman.
        if (NativeMethods.FindWindowEx(progman, 0, "SHELLDLL_DefView", null) != 0)
            Worker = NativeMethods.FindWindowEx(progman, 0, "WorkerW", null);
        if (Worker == 0)
        {
            NativeMethods.EnumWindows((hwnd, _) =>
            {
                if (NativeMethods.FindWindowEx(hwnd, 0, "SHELLDLL_DefView", null) == 0) return true;
                Worker = NativeMethods.FindWindowEx(0, hwnd, "WorkerW", null);
                return Worker == 0;
            }, 0);
        }
        if (!IsValid) throw new InvalidOperationException("未能创建桌面 WorkerW。请退出其他壁纸程序，确认资源管理器正在运行，然后重试。");
        log.Event("desktop.worker-found");
    }

    public void Attach(nint window, DisplayInfo display, bool interactive)
    {
        if (!interactive && !IsValid) FindWorker();
        var parent = interactive ? 0 : Worker;
        var style = NativeMethods.GetWindowLongPtr(window, NativeMethods.GwlStyle).ToInt64();
        style = interactive ? (style & ~NativeMethods.WsChild) | NativeMethods.WsPopup : (style & ~NativeMethods.WsPopup) | NativeMethods.WsChild;
        NativeMethods.SetWindowLongPtr(window, NativeMethods.GwlStyle, (nint)style);
        var extended = NativeMethods.GetWindowLongPtr(window, NativeMethods.GwlExStyle).ToInt64() | NativeMethods.WsExToolWindow;
        extended = interactive ? extended & ~(NativeMethods.WsExNoActivate | NativeMethods.WsExTransparent) : extended | NativeMethods.WsExNoActivate | NativeMethods.WsExTransparent;
        NativeMethods.SetWindowLongPtr(window, NativeMethods.GwlExStyle, (nint)extended);
        Marshal.SetLastPInvokeError(0);
        if (NativeMethods.SetParent(window, parent) == 0 && Marshal.GetLastPInvokeError() != 0) throw new Win32Exception(Marshal.GetLastPInvokeError());
        Position(window, display, parent);
        log.Event("window.bound", new { interactive, display.Bounds.Width, display.Bounds.Height, display.Dpi });
    }

    public static void Position(nint window, DisplayInfo display, nint parent)
    {
        var position = new NativeMethods.Point(display.Bounds.X, display.Bounds.Y);
        if (parent != 0 && !NativeMethods.ScreenToClient(parent, ref position)) throw new Win32Exception();
        if (!NativeMethods.SetWindowPos(window, 0, position.X, position.Y, display.Bounds.Width, display.Bounds.Height, NativeMethods.SwpNoActivate | NativeMethods.SwpFrameChanged)) throw new Win32Exception();
    }
}
