namespace ArkWallpaper;

internal sealed record BackgroundOption(string Id, string Name)
{
    public override string ToString() => Name;
}

internal sealed class SettingsForm : Form
{
    private readonly TextBox model = new() { Width = 245, PlaceholderText = "留空自动选择，或输入 16 位资源 ID" };
    private readonly ComboBox fit, background, theme, perspective;
    private readonly NumericUpDown scale, x, y, clockScale, clockX, clockY;
    private readonly CheckBox locked, clockEnabled, clockLocked, pointer;
    private readonly Button color = new() { Text = "选择颜色…", AutoSize = true };
    private WallpaperSettings current;
    public event Action<WallpaperSettings>? Applied;

    public SettingsForm(WallpaperSettings settings, IReadOnlyList<BackgroundOption> backgrounds)
    {
        SuspendLayout();
        current = settings;
        Text = "Ark Wallpaper · 壁纸设置";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(520, 500);
        MinimumSize = new Size(490, 500);
        var tabs = new TabControl { Dock = DockStyle.Fill };
        var layout = Page(tabs, "模型与背景");
        var clock = Page(tabs, "桌面时钟");
        model.Text = settings.ModelID;
        Add(layout, "资源 ID", model);
        Add(layout, "", new Label { Text = "在“打开查看器”中选择造型并复制资源 ID。", AutoSize = true });
        fit = Choice(WallpaperSettings.Fits, ["完整显示", "等比覆盖", "宽度铺满", "高度铺满", "拉伸铺满"], settings.FitMode);
        Add(layout, "填充方式", fit);
        scale = Number(.25m, 3, settings.Scale, .05m); Add(layout, "模型缩放", scale);
        x = Number(-100, 100, settings.OffsetX); Add(layout, "水平偏移 (%)", x);
        y = Number(-100, 100, settings.OffsetY); Add(layout, "垂直偏移 (%)", y);
        locked = Toggle("锁定模型位置与缩放", settings.LayoutLocked); Add(layout, "", locked);
        color.BackColor = ColorTranslator.FromHtml(settings.BackgroundColor);
        color.ForeColor = color.BackColor.GetBrightness() > .5 ? Color.Black : Color.White;
        color.Click += (_, _) =>
        {
            using var dialog = new ColorDialog { Color = color.BackColor, FullOpen = true };
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            color.BackColor = dialog.Color;
            color.ForeColor = dialog.Color.GetBrightness() > .5 ? Color.Black : Color.White;
        };
        Add(layout, "背景色", color);
        background = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 290 };
        background.Items.Add(new BackgroundOption("", "纯色背景"));
        background.Items.AddRange(backgrounds.Cast<object>().ToArray());
        if (settings.BackgroundImageID.Length > 0 && !backgrounds.Any(b => b.Id == settings.BackgroundImageID))
            background.Items.Add(new BackgroundOption(settings.BackgroundImageID, settings.BackgroundImageID + "（当前不可用）"));
        background.SelectedIndex = Math.Max(0, background.Items.Cast<BackgroundOption>().ToList().FindIndex(b => b.Id == settings.BackgroundImageID));
        Add(layout, "背景图片", background);
        clockEnabled = Toggle("显示桌面时钟", settings.ClockEnabled); Add(clock, "", clockEnabled);
        theme = Choice(WallpaperSettings.Themes, ["罗德岛", "孤星", "彩虹六号", "火山假日", "纯文字重字"], settings.ClockTheme); Add(clock, "主题", theme);
        clockScale = Number(.5m, 2, settings.ClockScale, .05m); Add(clock, "时钟缩放", clockScale);
        clockX = Number(4, 96, settings.ClockX); Add(clock, "横向位置 (%)", clockX);
        clockY = Number(6, 94, settings.ClockY); Add(clock, "纵向位置 (%)", clockY);
        clockLocked = Toggle("锁定时钟位置", settings.ClockLocked); Add(clock, "", clockLocked);
        perspective = Choice(WallpaperSettings.Perspectives, ["无", "向左", "向右"], settings.ClockPerspective); Add(clock, "固定透视", perspective);
        pointer = Toggle("透视随鼠标移动", settings.ClockPointerPerspective); Add(clock, "", pointer);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 55, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
        var apply = new Button { Text = "应用", AutoSize = true };
        var close = new Button { Text = "关闭", AutoSize = true };
        var reset = new Button { Text = "恢复外观默认值", AutoSize = true };
        apply.Click += (_, _) => Apply();
        close.Click += (_, _) => Close();
        reset.Click += (_, _) =>
        {
            fit.SelectedIndex = 1; scale.Value = 1; x.Value = y.Value = 0; locked.Checked = true;
            color.BackColor = Color.Black; color.ForeColor = Color.White; background.SelectedIndex = 0;
            clockEnabled.Checked = clockLocked.Checked = true; theme.SelectedIndex = 0; clockScale.Value = 1;
            clockX.Value = 82; clockY.Value = 18; perspective.SelectedIndex = 0; pointer.Checked = false;
        };
        buttons.Controls.AddRange([close, apply, reset]);
        Controls.Add(tabs); Controls.Add(buttons);
        AcceptButton = apply; CancelButton = close;
        // Keep the complete code-built layout in 96-DPI units until every child
        // has been added; scaling earlier would mix scaled fonts with unscaled bounds.
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        ResumeLayout(true);
    }

    // Refresh drag results so an open settings window cannot restore stale coordinates.
    public void Synchronize(WallpaperSettings s)
    {
        current = s;
        scale.Value = (decimal)s.Scale; x.Value = (decimal)s.OffsetX; y.Value = (decimal)s.OffsetY;
        clockX.Value = (decimal)s.ClockX; clockY.Value = (decimal)s.ClockY;
    }

    private void Apply()
    {
        var id = model.Text.Trim();
        if (id.Length != 0 && !WallpaperSettings.ValidModel(id)) { MessageBox.Show(this, "资源 ID 应为 16 位十六进制字符，或留空自动选择。", Text); return; }
        current = (current with
        {
            ModelID = id, FitMode = WallpaperSettings.Fits[fit.SelectedIndex], Scale = (double)scale.Value,
            OffsetX = (double)x.Value, OffsetY = (double)y.Value, LayoutLocked = locked.Checked,
            BackgroundColor = $"#{color.BackColor.R:X2}{color.BackColor.G:X2}{color.BackColor.B:X2}", BackgroundImageID = ((BackgroundOption)background.SelectedItem!).Id,
            ClockEnabled = clockEnabled.Checked, ClockTheme = WallpaperSettings.Themes[theme.SelectedIndex], ClockScale = (double)clockScale.Value,
            ClockX = (double)clockX.Value, ClockY = (double)clockY.Value, ClockLocked = clockLocked.Checked,
            ClockPerspective = WallpaperSettings.Perspectives[perspective.SelectedIndex], ClockPointerPerspective = pointer.Checked
        }).Normalize();
        Applied?.Invoke(current);
    }

    private static TableLayoutPanel Page(TabControl tabs, string title)
    {
        var page = new TabPage(title) { Padding = new Padding(16), AutoScroll = true };
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        page.Controls.Add(table); tabs.TabPages.Add(page); return table;
    }
    private static void Add(TableLayoutPanel table, string label, Control control)
    {
        var row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 11, 8, 10) }, 0, row);
        control.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        control.Margin = new Padding(0, 7, 0, 9); table.Controls.Add(control, 1, row);
    }
    private static NumericUpDown Number(decimal min, decimal max, double value, decimal step = 1) => new() { Minimum = min, Maximum = max, Value = (decimal)value, DecimalPlaces = 2, Increment = step, Width = 150 };
    private static CheckBox Toggle(string label, bool value) => new() { Text = label, Checked = value, AutoSize = true };
    private static ComboBox Choice(string[] ids, string[] labels, string selected)
    {
        var control = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 245 };
        control.Items.AddRange(labels); control.SelectedIndex = Math.Max(0, Array.IndexOf(ids, selected)); return control;
    }
}
