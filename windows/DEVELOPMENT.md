# Windows 壁纸宿主

宿主使用 .NET 8、WinForms 和 WebView2，仅管理桌面窗口、托盘、设置及本地服务。模型渲染、动作选择、拖动和时钟透视继续使用原有网页实现。

## 构建和运行

需要 Windows 10/11、Node.js/npm、.NET 8 或更新的 SDK，以及 Microsoft Edge WebView2 Runtime。构建产物自带 .NET 运行时，仍需保留工程及用户提供的资源；它是开发版宿主，不是独立资源发行包。

```powershell
npm ci
npm run windows:build
npm run windows:run
```

双架构构建：

```powershell
npm run windows:build -- --arch=all
```

输出在 `build/windows/win-x64/` 与 `build/windows/win-arm64/`。也可直接启动其中的 `ArkWallpaper.exe`。构建时生成的 `launch.local.json` 记录开发机启动信息，随 `build/` 一起排除在 Git 之外。工程或 Node 安装位置变化后需要重新构建。

资源配置沿用 `config/runtime.local.json`、示例配置和 `ARKNIGHTS_*` 环境变量。首次启动先检查服务健康状态；只有服务不可用时才启动自己的 npm 进程。Windows 不能通过无 shell 的 `ProcessStartInfo` 直接执行 `npm.cmd`，因此实际调用为 `node` + `npm-cli.js` + `run` + `start`，每个参数单独传递。

自启动服务加入独立的 Windows Job Object，退出宿主时清理全部后代进程；即使 npm 的中间进程提前退出也不会遗留 Node。复用的已有服务不会加入这个 Job，也不会被宿主终止。

托盘菜单提供壁纸设置、交互模式、暂停/继续、重新加载、查看器、工程位置和诊断。默认点击穿透；打开交互时临时将现有窗口移到桌面图标上方，关闭时重新挂回 WorkerW。模型与时钟锁定独立控制。

设置保存在本地应用数据目录的 `Ark-Wallpaper/settings.json`，原子替换并保留上一份备份。WebView 缓存和默认关闭的滚动日志同样保存在应用数据目录。日志只记录事件名称和数值/枚举，不记录资源路径、URL 查询或服务器输出。

## 验证

```powershell
npm test
npm run audit
npm run windows:test
npm run windows:smoke
```

`windows:test` 不需要游戏资源，覆盖设置范围、损坏恢复、URL/消息协议、日志轮换、服务复用和多屏拓扑规则。

`windows:smoke` 需要先构建并配置本地资源，在当前桌面创建真实壁纸窗口，会短暂切换交互模式。使用独立端口、设置和 WebView 数据目录；完成后关闭测试宿主及其创建的服务。测试报告、模型截图与诊断日志保存在忽略的 `build/windows/smoke-*` 目录。截图在交互模式下捕获，避免完全被其他应用遮挡的桌面 WebView 无可用绘制帧。请在普通宿主退出后运行，避免两个壁纸实例同时覆盖桌面。

自动验证包括每屏 WorkerW 绑定、物理/CSS 尺寸、交互与暂停不导航、设置热更新、外部导航拦截，以及本地静态/动态模型加载。`src/main.jsx` 的 `data-loaded-model` 只在模型实际完成加载时出现，测试不会将空 Canvas 当作加载成功。

还需在目标机器验收：

- 桌面图标的单击、双击、框选、右键以及 Win+D；退出交互后保持可用。
- 未锁定模型拖动、滚轮缩放和锁定后的动作点击；时钟拖动不带动模型。
- 增减显示器、不同缩放和负坐标布局；未变动屏幕不应重新加载。
- 实际 Explorer 重启及睡眠/会话锁定恢复。自动测试不主动重启用户的 Explorer 或让电脑休眠。
- arm64 原生机器上的运行行为；在 x64 上构建 arm64 不能替代实机验证。

WorkerW 使用 Windows 未公开的桌面约定。找不到桌面宿主时应用会明确报错；Explorer 恢复期间采用有限频率重试。通常重绑保留 WebView，只有 HWND 或 WebView 浏览器进程已失效时才重新创建受影响的渲染器。
