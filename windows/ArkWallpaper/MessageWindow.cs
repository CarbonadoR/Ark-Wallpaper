namespace ArkWallpaper;

// Hidden top-level window (not HWND_MESSAGE) receives shell broadcasts.
internal sealed class MessageWindow : Form
{
    private readonly uint taskbarCreated = NativeMethods.RegisterWindowMessage("TaskbarCreated");
    public event Action? DesktopChanged;
    public event Action? DisplaysChanged;
    public event Action<bool>? SleepingChanged;
    public event Action<bool>? SessionLockedChanged;
    public MessageWindow()
    {
        ShowInTaskbar = false;
        _ = Handle;
        NativeMethods.WTSRegisterSessionNotification(Handle, 0);
    }
    protected override void SetVisibleCore(bool value) => base.SetVisibleCore(false);
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == taskbarCreated) DesktopChanged?.Invoke();
        if (m.Msg is 0x007e or 0x02e0) DisplaysChanged?.Invoke();
        if (m.Msg == 0x0218)
        {
            if (m.WParam == 4) SleepingChanged?.Invoke(true);
            if (m.WParam == 7 || m.WParam == 18) SleepingChanged?.Invoke(false);
        }
        if (m.Msg == 0x02b1)
        {
            if (m.WParam == 7) SessionLockedChanged?.Invoke(true);
            if (m.WParam == 8) SessionLockedChanged?.Invoke(false);
        }
        base.WndProc(ref m);
    }
    protected override void Dispose(bool disposing)
    {
        if (IsHandleCreated) NativeMethods.WTSUnRegisterSessionNotification(Handle);
        base.Dispose(disposing);
    }
}
