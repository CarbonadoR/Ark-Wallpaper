import AppKit
import CoreGraphics
import Foundation
import WebKit

final class WallpaperWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

private struct WallpaperBackground: Decodable {
    let id: String
    let name: String
    let imageUrls: [String]
}

private struct WallpaperBackgroundCatalog: Decodable {
    let backgrounds: [WallpaperBackground]
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var statusItem: NSStatusItem!
    private var statusLabel: NSMenuItem!
    private var interactionItem: NSMenuItem!
    private var pauseItem: NSMenuItem!
    private var settingsPanel: NSPanel?
    private var fitControl: NSPopUpButton?
    private var scaleControl: NSSlider?
    private var xControl: NSSlider?
    private var yControl: NSSlider?
    private var lockControl: NSButton?
    private var backgroundColorControl: NSColorWell?
    private var backgroundImageControl: NSPopUpButton?
    private var scaleLabel: NSTextField?
    private var xLabel: NSTextField?
    private var yLabel: NSTextField?
    private var windows: [WallpaperWindow] = []
    private var webViews: [WKWebView] = []
    private var serverProcess: Process?
    private var interactionEnabled = false
    private var paused = false
    private var backgrounds: [WallpaperBackground] = []
    private let fitKeys = ["contain", "cover", "width", "height", "stretch"]
    private let fitLabels = ["适应屏幕（完整显示）", "覆盖屏幕（自动裁切）", "宽度铺满（裁切上下）", "高度铺满（裁切左右）", "拉伸铺满（非等比）"]

    private var projectRoot: String { Bundle.main.object(forInfoDictionaryKey: "AKProjectRoot") as? String ?? "" }
    private var npmPath: String { Bundle.main.object(forInfoDictionaryKey: "AKNpmPath") as? String ?? "/opt/homebrew/bin/npm" }
    private var serverURL: URL {
        let value = Bundle.main.object(forInfoDictionaryKey: "AKServerURL") as? String ?? "http://127.0.0.1:8791"
        return URL(string: value)!
    }
    private var modelID: String { UserDefaults.standard.string(forKey: "modelID") ?? "" }
    private var fitMode: String {
        let value = UserDefaults.standard.string(forKey: "fitMode") ?? "cover"
        return fitKeys.contains(value) ? value : "cover"
    }
    private var scale: Double { UserDefaults.standard.object(forKey: "scale") == nil ? 1 : UserDefaults.standard.double(forKey: "scale") }
    private var offsetX: Double { UserDefaults.standard.double(forKey: "offsetX") }
    private var offsetY: Double { UserDefaults.standard.double(forKey: "offsetY") }
    private var layoutLocked: Bool { UserDefaults.standard.object(forKey: "layoutLocked") == nil ? true : UserDefaults.standard.bool(forKey: "layoutLocked") }
    private var backgroundColorHex: String {
        let value = UserDefaults.standard.string(forKey: "backgroundColor") ?? "#000000"
        return value.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) == nil ? "#000000" : value.uppercased()
    }
    private var backgroundImageID: String { UserDefaults.standard.string(forKey: "backgroundImageID") ?? "" }
    private var backgroundImageURLs: [String] { backgrounds.first(where: { $0.id == backgroundImageID })?.imageUrls ?? [] }

    private func color(from hex: String) -> NSColor {
        var value: UInt64 = 0
        Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&value)
        return NSColor(
            srgbRed: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1
        )
    }

    private func hex(from color: NSColor) -> String {
        guard let rgb = color.usingColorSpace(.sRGB) else { return "#000000" }
        return String(format: "#%02X%02X%02X", Int(round(rgb.redComponent * 255)), Int(round(rgb.greenComponent * 255)), Int(round(rgb.blueComponent * 255)))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureMenu()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        Task {
            if !(await serverReady()) { launchServer(); guard await waitForServer() else { showStartupError(); return } }
            await loadBackgrounds()
            statusLabel.title = modelID.isEmpty ? "运行中 · 自动选择首个模型" : "运行中 · \(modelID)"
            rebuildWindows()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        NotificationCenter.default.removeObserver(self)
        if serverProcess?.isRunning == true { serverProcess?.terminate() }
    }

    private func configureMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "AK ◇"
        statusItem.button?.toolTip = "Arknights Dynamic Wallpaper"
        let menu = NSMenu()
        statusLabel = NSMenuItem(title: "正在连接本地查看器…", action: nil, keyEquivalent: "")
        statusLabel.isEnabled = false
        menu.addItem(statusLabel)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "选择模型 ID…", action: #selector(selectModel), keyEquivalent: "s"))
        menu.addItem(NSMenuItem(title: "壁纸外观、尺寸与位置…", action: #selector(showLayout), keyEquivalent: ","))
        menu.addItem(NSMenuItem(title: "重新加载壁纸", action: #selector(reload), keyEquivalent: "r"))
        interactionItem = NSMenuItem(title: "启用壁纸交互", action: #selector(toggleInteraction), keyEquivalent: "i")
        menu.addItem(interactionItem)
        pauseItem = NSMenuItem(title: "暂停壁纸", action: #selector(togglePause), keyEquivalent: "p")
        menu.addItem(pauseItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "打开完整查看器", action: #selector(openViewer), keyEquivalent: "o"))
        menu.addItem(NSMenuItem(title: "在访达中显示工程", action: #selector(showProject), keyEquivalent: "f"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items where item.action != nil { item.target = self }
        statusItem.menu = menu
    }

    private func launchServer() {
        guard !projectRoot.isEmpty else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: npmPath)
        process.arguments = ["run", "start"]
        process.currentDirectoryURL = URL(fileURLWithPath: projectRoot, isDirectory: true)
        var environment = ProcessInfo.processInfo.environment
        for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] { environment.removeValue(forKey: key) }
        environment["PATH"] = "\(URL(fileURLWithPath: npmPath).deletingLastPathComponent().path):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run(); serverProcess = process } catch { statusLabel.title = "服务启动失败" }
    }

    private func serverReady() async -> Bool {
        var request = URLRequest(url: serverURL.appendingPathComponent("api/status")); request.timeoutInterval = 1
        do { let (_, response) = try await URLSession.shared.data(for: request); return (response as? HTTPURLResponse)?.statusCode == 200 } catch { return false }
    }
    private func waitForServer() async -> Bool {
        for _ in 0..<40 { if await serverReady() { return true }; try? await Task.sleep(for: .milliseconds(250)) }
        return false
    }

    private func loadBackgrounds() async {
        var request = URLRequest(url: serverURL.appendingPathComponent("api/backgrounds")); request.timeoutInterval = 3
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { backgrounds = []; return }
            backgrounds = try JSONDecoder().decode(WallpaperBackgroundCatalog.self, from: data).backgrounds
        } catch {
            backgrounds = []
        }
    }

    private func wallpaperURL() -> URL {
        var parts = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "wallpaper", value: "1"), URLQueryItem(name: "fit", value: fitMode), URLQueryItem(name: "scale", value: String(scale)), URLQueryItem(name: "x", value: String(offsetX)), URLQueryItem(name: "y", value: String(offsetY)), URLQueryItem(name: "locked", value: layoutLocked ? "1" : "0"), URLQueryItem(name: "background", value: backgroundColorHex)]
        if backgroundImageURLs.count == 1 {
            items.append(URLQueryItem(name: "backgroundImage", value: backgroundImageURLs[0]))
        } else if backgroundImageURLs.count == 2 {
            items.append(URLQueryItem(name: "backgroundImageLeft", value: backgroundImageURLs[0]))
            items.append(URLQueryItem(name: "backgroundImageRight", value: backgroundImageURLs[1]))
        }
        if !modelID.isEmpty { items.append(URLQueryItem(name: "model", value: modelID)) }
        parts.queryItems = items
        return parts.url!
    }
    private func desktopLevel() -> NSWindow.Level { NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1) }
    private func makeWebView(frame: NSRect) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(self, name: "wallpaperTransform")
        let view = WKWebView(frame: frame, configuration: configuration)
        view.setValue(false, forKey: "drawsBackground")
        view.autoresizingMask = [.width, .height]
        view.load(URLRequest(url: wallpaperURL()))
        return view
    }
    private func rebuildWindows() {
        windows.forEach { $0.close() }; windows.removeAll(); webViews.removeAll()
        for screen in NSScreen.screens {
            let window = WallpaperWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
            window.setFrame(screen.frame, display: true)
            window.level = interactionEnabled ? .normal : desktopLevel()
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            window.backgroundColor = color(from: backgroundColorHex); window.isOpaque = true; window.hasShadow = false
            window.ignoresMouseEvents = !interactionEnabled; window.acceptsMouseMovedEvents = interactionEnabled; window.isReleasedWhenClosed = false
            let view = makeWebView(frame: NSRect(origin: .zero, size: screen.frame.size)); window.contentView = view
            if !paused { window.orderFrontRegardless() }
            windows.append(window); webViews.append(view)
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "wallpaperTransform", let values = message.body as? [String: Any] else { return }
        let defaults = UserDefaults.standard
        if let number = values["scale"] as? NSNumber { let value = min(3, max(0.25, number.doubleValue)); defaults.set(value, forKey: "scale"); scaleControl?.doubleValue = value }
        if let number = values["offsetX"] as? NSNumber { let value = min(100, max(-100, number.doubleValue)); defaults.set(value, forKey: "offsetX"); xControl?.doubleValue = value }
        if let number = values["offsetY"] as? NSNumber { let value = min(100, max(-100, number.doubleValue)); defaults.set(value, forKey: "offsetY"); yControl?.doubleValue = value }
        updateLabels()
    }

    private func label(_ text: String, _ frame: NSRect, secondary: Bool = false) -> NSTextField {
        let value = NSTextField(labelWithString: text); value.frame = frame; value.textColor = secondary ? .secondaryLabelColor : .labelColor; value.font = secondary ? .systemFont(ofSize: 11) : .systemFont(ofSize: 12, weight: .medium); return value
    }
    @objc private func showLayout() {
        if let settingsPanel { NSApp.activate(ignoringOtherApps: true); settingsPanel.makeKeyAndOrderFront(nil); return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 480), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "壁纸外观、尺寸与位置"; panel.isFloatingPanel = true; panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false; panel.level = .floating; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; panel.center()
        let content = NSView(frame: panel.contentView?.bounds ?? .zero); panel.contentView = content
        content.addSubview(label("背景图", NSRect(x: 24, y: 432, width: 110, height: 20)))
        let backgroundImage = NSPopUpButton(frame: NSRect(x: 145, y: 426, width: 270, height: 28)); backgroundImage.addItem(withTitle: "无（仅背景色）"); backgroundImage.addItems(withTitles: backgrounds.map(\.name)); backgroundImage.selectItem(at: (backgrounds.firstIndex(where: { $0.id == backgroundImageID }).map { $0 + 1 }) ?? 0); backgroundImage.target = self; backgroundImage.action = #selector(backgroundImageChanged); content.addSubview(backgroundImage)
        content.addSubview(label("背景颜色", NSRect(x: 24, y: 382, width: 110, height: 20)))
        let backgroundColor = NSColorWell(frame: NSRect(x: 145, y: 376, width: 72, height: 28)); backgroundColor.color = color(from: backgroundColorHex); backgroundColor.target = self; backgroundColor.action = #selector(backgroundColorChanged); backgroundColor.isContinuous = true; content.addSubview(backgroundColor)
        NSColorPanel.shared.showsAlpha = false
        content.addSubview(label("填充模式", NSRect(x: 24, y: 326, width: 110, height: 20)))
        let fit = NSPopUpButton(frame: NSRect(x: 145, y: 320, width: 270, height: 28)); fit.addItems(withTitles: fitLabels); fit.selectItem(at: fitKeys.firstIndex(of: fitMode) ?? 1); fit.target = self; fit.action = #selector(layoutChanged); content.addSubview(fit)
        content.addSubview(label("缩放", NSRect(x: 24, y: 276, width: 110, height: 20)))
        let scaleSlider = NSSlider(value: scale, minValue: 0.25, maxValue: 3, target: self, action: #selector(layoutChanged)); scaleSlider.frame = NSRect(x: 145, y: 274, width: 210, height: 24); scaleSlider.isContinuous = true; content.addSubview(scaleSlider)
        let scaleValue = label("", NSRect(x: 365, y: 276, width: 52, height: 20), secondary: true); scaleValue.alignment = .right; content.addSubview(scaleValue)
        content.addSubview(label("水平位置", NSRect(x: 24, y: 226, width: 110, height: 20)))
        let xSlider = NSSlider(value: offsetX, minValue: -100, maxValue: 100, target: self, action: #selector(layoutChanged)); xSlider.frame = NSRect(x: 145, y: 224, width: 210, height: 24); xSlider.isContinuous = true; content.addSubview(xSlider)
        let xValue = label("", NSRect(x: 365, y: 226, width: 52, height: 20), secondary: true); xValue.alignment = .right; content.addSubview(xValue)
        content.addSubview(label("垂直位置", NSRect(x: 24, y: 176, width: 110, height: 20)))
        let ySlider = NSSlider(value: offsetY, minValue: -100, maxValue: 100, target: self, action: #selector(layoutChanged)); ySlider.frame = NSRect(x: 145, y: 174, width: 210, height: 24); ySlider.isContinuous = true; content.addSubview(ySlider)
        let yValue = label("", NSRect(x: 365, y: 176, width: 52, height: 20), secondary: true); yValue.alignment = .right; content.addSubview(yValue)
        let lock = NSButton(checkboxWithTitle: "锁定壁纸尺寸与位置（防止交互时误拖动）", target: self, action: #selector(layoutChanged)); lock.frame = NSRect(x: 141, y: 125, width: 276, height: 24); lock.state = layoutLocked ? .on : .off; content.addSubview(lock)
        let hint = label("解锁后可在交互模式中拖动壁纸或用滚轮缩放；所有调整会自动保存。", NSRect(x: 24, y: 77, width: 392, height: 34), secondary: true); hint.maximumNumberOfLines = 2; content.addSubview(hint)
        let reset = NSButton(title: "恢复默认", target: self, action: #selector(resetLayout)); reset.frame = NSRect(x: 24, y: 22, width: 96, height: 32); content.addSubview(reset)
        let done = NSButton(title: "完成", target: self, action: #selector(closeLayout)); done.keyEquivalent = "\r"; done.frame = NSRect(x: 320, y: 22, width: 96, height: 32); content.addSubview(done)
        settingsPanel = panel; fitControl = fit; scaleControl = scaleSlider; xControl = xSlider; yControl = ySlider; lockControl = lock; backgroundColorControl = backgroundColor; backgroundImageControl = backgroundImage; scaleLabel = scaleValue; xLabel = xValue; yLabel = yValue; updateLabels()
        NSApp.activate(ignoringOtherApps: true); panel.orderFrontRegardless(); panel.makeKey()
    }
    private func updateLabels() { scaleLabel?.stringValue = String(format: "%.0f%%", (scaleControl?.doubleValue ?? 1) * 100); xLabel?.stringValue = String(format: "%+.0f%%", xControl?.doubleValue ?? 0); yLabel?.stringValue = String(format: "%+.0f%%", yControl?.doubleValue ?? 0) }
    @objc private func layoutChanged() {
        guard let fitControl, let scaleControl, let xControl, let yControl, let lockControl else { return }
        let defaults = UserDefaults.standard; defaults.set(fitKeys[max(0, fitControl.indexOfSelectedItem)], forKey: "fitMode"); defaults.set(scaleControl.doubleValue, forKey: "scale"); defaults.set(xControl.doubleValue, forKey: "offsetX"); defaults.set(yControl.doubleValue, forKey: "offsetY"); defaults.set(lockControl.state == .on, forKey: "layoutLocked"); updateLabels(); applyLayout()
    }
    private func applyLayout() {
        let values: [String: Any] = ["fit": fitMode, "scale": scale, "offsetX": offsetX, "offsetY": offsetY, "locked": layoutLocked]
        guard let data = try? JSONSerialization.data(withJSONObject: values), let json = String(data: data, encoding: .utf8) else { return }
        webViews.forEach { $0.evaluateJavaScript("window.__setWallpaperTransform?.(\(json))") }
    }
    @objc private func backgroundColorChanged() {
        guard let backgroundColorControl else { return }
        UserDefaults.standard.set(hex(from: backgroundColorControl.color), forKey: "backgroundColor")
        applyBackground()
    }
    @objc private func backgroundImageChanged() {
        guard let backgroundImageControl else { return }
        let index = backgroundImageControl.indexOfSelectedItem - 1
        UserDefaults.standard.set(backgrounds.indices.contains(index) ? backgrounds[index].id : "", forKey: "backgroundImageID")
        applyBackground()
    }
    private func applyBackground() {
        let values: [String: Any] = ["color": backgroundColorHex, "imageUrl": backgroundImageURLs.count == 1 ? backgroundImageURLs[0] : "", "imageUrls": backgroundImageURLs]
        guard let data = try? JSONSerialization.data(withJSONObject: values), let json = String(data: data, encoding: .utf8) else { return }
        webViews.forEach { $0.evaluateJavaScript("window.__setWallpaperBackground?.(\(json))") }
        let nativeColor = color(from: backgroundColorHex)
        windows.forEach { $0.backgroundColor = nativeColor }
    }
    @objc private func resetLayout() { fitControl?.selectItem(at: 1); scaleControl?.doubleValue = 1; xControl?.doubleValue = 0; yControl?.doubleValue = 0; lockControl?.state = .on; backgroundColorControl?.color = .black; backgroundImageControl?.selectItem(at: 0); layoutChanged(); backgroundColorChanged(); backgroundImageChanged() }
    @objc private func closeLayout() { settingsPanel?.orderOut(nil) }

    @objc private func selectModel() {
        NSApp.activate(ignoringOtherApps: true)
        let input = NSTextField(string: modelID); input.placeholderString = "查看器中的 16 位模型 ID"; input.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
        let alert = NSAlert(); alert.messageText = "选择动态壁纸模型"; alert.informativeText = "从完整查看器的 Model Inspector 复制模型 ID；留空则自动选择第一个动态立绘。"; alert.accessoryView = input; alert.addButton(withTitle: "应用"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let value = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.isEmpty || value.range(of: "^[0-9a-f]{16}$", options: .regularExpression) != nil else { NSSound.beep(); return }
        UserDefaults.standard.set(value, forKey: "modelID"); statusLabel.title = value.isEmpty ? "运行中 · 自动选择首个模型" : "运行中 · \(value)"; reloadViews()
    }
    private func reloadViews() { let request = URLRequest(url: wallpaperURL(), cachePolicy: .reloadIgnoringLocalCacheData); webViews.forEach { $0.load(request) } }
    @objc private func reload() { Task { if !(await serverReady()) { launchServer(); _ = await waitForServer() }; if windows.isEmpty { rebuildWindows() } else { reloadViews() } } }
    @objc private func screensChanged() { rebuildWindows() }
    @objc private func toggleInteraction() { interactionEnabled.toggle(); interactionItem.state = interactionEnabled ? .on : .off; interactionItem.title = interactionEnabled ? "结束壁纸交互" : "启用壁纸交互"; for window in windows { window.ignoresMouseEvents = !interactionEnabled; window.acceptsMouseMovedEvents = interactionEnabled; window.level = interactionEnabled ? .normal : desktopLevel(); if interactionEnabled { window.makeKeyAndOrderFront(nil) } else { window.orderFrontRegardless() } }; if interactionEnabled { NSApp.activate(ignoringOtherApps: true) } }
    @objc private func togglePause() { paused.toggle(); pauseItem.state = paused ? .on : .off; pauseItem.title = paused ? "继续壁纸" : "暂停壁纸"; if paused { windows.forEach { $0.orderOut(nil) } } else { windows.forEach { $0.orderFrontRegardless() } } }
    @objc private func openViewer() { NSWorkspace.shared.open(serverURL) }
    @objc private func showProject() { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: projectRoot, isDirectory: true)]) }
    @objc private func showStartupError() { statusLabel.title = "无法启动本地服务"; NSApp.activate(ignoringOtherApps: true); let alert = NSAlert(); alert.messageText = "无法启动 Arknights 本地查看器"; alert.informativeText = "请确认工程目录和 runtime.local.json 中的资源路径有效。"; alert.alertStyle = .critical; alert.runModal() }
    @objc private func quit() { NSApp.terminate(nil) }
}

@main
struct ArknightsWallpaperApp {
    static func main() { let application = NSApplication.shared; let delegate = AppDelegate(); application.delegate = delegate; application.run() }
}
