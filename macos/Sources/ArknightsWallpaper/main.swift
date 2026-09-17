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
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    private var statusItem: NSStatusItem!
    private var statusLabel: NSMenuItem!
    private var interactionItem: NSMenuItem!
    private var pauseItem: NSMenuItem!
    private var diagnosticItem: NSMenuItem!
    private var settingsPanel: NSPanel?
    private var fitControl: NSPopUpButton?
    private var scaleControl: NSSlider?
    private var xControl: NSSlider?
    private var yControl: NSSlider?
    private var lockControl: NSButton?
    private var backgroundColorControl: NSColorWell?
    private var backgroundImageControl: NSPopUpButton?
    private var clockEnabledControl: NSButton?
    private var clockThemeControl: NSPopUpButton?
    private var clockScaleControl: NSSlider?
    private var clockLockControl: NSButton?
    private var clockPerspectiveControl: NSPopUpButton?
    private var clockScaleLabel: NSTextField?
    private var scaleLabel: NSTextField?
    private var xLabel: NSTextField?
    private var yLabel: NSTextField?
    private var windows: [WallpaperWindow] = []
    private var webViews: [WKWebView] = []
    private var serverProcess: Process?
    private var interactionEnabled = false
    private var paused = false
    private var diagnosticsEnabled = UserDefaults.standard.bool(forKey: "diagnosticsEnabled")
    private var workspaceDiagnosticsRegistered = false
    private var lastScreenSignature = ""
    private var diagnosticWebViews: Set<ObjectIdentifier> = []
    private var webViewLabels: [ObjectIdentifier: String] = [:]
    private var pendingNavigationReasons: [ObjectIdentifier: String] = [:]
    private var backgrounds: [WallpaperBackground] = []
    private let fitKeys = ["contain", "cover", "width", "height", "stretch"]
    private let fitLabels = ["适应屏幕（完整显示）", "覆盖屏幕（自动裁切）", "宽度铺满（裁切上下）", "高度铺满（裁切左右）", "拉伸铺满（非等比）"]
    private let clockThemeKeys = ["rhodes", "lonetrail", "rainbowsix", "volcano", "monochrome"]
    private let clockThemeLabels = ["罗德岛终端", "孤星轨道", "彩虹六号终端", "火山假日", "纯文字重字"]
    private let clockPerspectiveKeys = ["none", "left", "right"]
    private let clockPerspectiveLabels = ["关闭透视", "左倾透视", "右倾透视"]

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
    private var clockEnabled: Bool { UserDefaults.standard.object(forKey: "clockEnabled") == nil ? true : UserDefaults.standard.bool(forKey: "clockEnabled") }
    private var clockTheme: String {
        let value = UserDefaults.standard.string(forKey: "clockTheme") ?? "rhodes"
        return clockThemeKeys.contains(value) ? value : "rhodes"
    }
    private var clockScale: Double {
        let value = UserDefaults.standard.object(forKey: "clockScale") == nil ? 1 : UserDefaults.standard.double(forKey: "clockScale")
        return min(2, max(0.5, value))
    }
    private var clockX: Double { UserDefaults.standard.object(forKey: "clockX") == nil ? 82 : UserDefaults.standard.double(forKey: "clockX") }
    private var clockY: Double { UserDefaults.standard.object(forKey: "clockY") == nil ? 18 : UserDefaults.standard.double(forKey: "clockY") }
    private var clockLocked: Bool { UserDefaults.standard.object(forKey: "clockLocked") == nil ? true : UserDefaults.standard.bool(forKey: "clockLocked") }
    private var clockPerspective: String {
        if let value = UserDefaults.standard.object(forKey: "clockPerspective") as? String, clockPerspectiveKeys.contains(value) { return value }
        return UserDefaults.standard.bool(forKey: "clockPerspective") ? "left" : "none"
    }

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

    private func diagnose(_ event: String, _ fields: [String: String] = [:]) {
        guard diagnosticsEnabled else { return }
        DiagnosticLog.shared.record(event, fields: fields)
    }

    private func displayID(for screen: NSScreen) -> UInt32 {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    }

    private func screenSignature() -> String {
        NSScreen.screens.map { screen in
            let frame = screen.frame
            return String(format: "%u:%.0f,%.0f,%.0fx%.0f@%.2f", displayID(for: screen), frame.origin.x, frame.origin.y, frame.width, frame.height, screen.backingScaleFactor)
        }.sorted().joined(separator: ";")
    }

    private func setWorkspaceDiagnosticsEnabled(_ enabled: Bool) {
        guard enabled != workspaceDiagnosticsRegistered else { return }
        let center = NSWorkspace.shared.notificationCenter
        let names: [Notification.Name] = [
            NSWorkspace.activeSpaceDidChangeNotification,
            NSWorkspace.didActivateApplicationNotification,
            NSWorkspace.didWakeNotification,
            NSWorkspace.willSleepNotification,
            NSWorkspace.sessionDidBecomeActiveNotification,
            NSWorkspace.sessionDidResignActiveNotification,
        ]
        if enabled {
            names.forEach { center.addObserver(self, selector: #selector(workspaceEvent(_:)), name: $0, object: nil) }
        } else {
            names.forEach { center.removeObserver(self, name: $0, object: nil) }
        }
        workspaceDiagnosticsRegistered = enabled
    }

    @objc private func workspaceEvent(_ notification: Notification) {
        diagnose("workspace.notification", ["name": notification.name.rawValue])
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        DiagnosticLog.shared.setEnabled(diagnosticsEnabled)
        configureMenu()
        setWorkspaceDiagnosticsEnabled(diagnosticsEnabled)
        diagnose("app.launch", ["diagnostics": diagnosticsEnabled ? "on" : "off", "screens": screenSignature()])
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        Task {
            if !(await serverReady()) {
                diagnose("server.unavailable-at-launch")
                launchServer()
                guard await waitForServer() else { diagnose("server.start-timeout"); showStartupError(); return }
            } else {
                diagnose("server.reused")
            }
            await loadBackgrounds()
            statusLabel.title = modelID.isEmpty ? "运行中 · 自动选择首个模型" : "运行中 · \(modelID)"
            rebuildWindows(reason: "startup")
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        diagnose("app.will-terminate")
        DiagnosticLog.shared.flush()
        NotificationCenter.default.removeObserver(self)
        setWorkspaceDiagnosticsEnabled(false)
        if serverProcess?.isRunning == true { serverProcess?.terminate() }
    }

    func applicationDidBecomeActive(_ notification: Notification) { diagnose("app.did-become-active") }
    func applicationDidResignActive(_ notification: Notification) { diagnose("app.did-resign-active") }
    func applicationDidHide(_ notification: Notification) { diagnose("app.did-hide") }
    func applicationDidUnhide(_ notification: Notification) { diagnose("app.did-unhide") }

    private func configureMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "AK ◇"
        statusItem.button?.toolTip = "Arknights Dynamic Wallpaper"
        let menu = NSMenu()
        statusLabel = NSMenuItem(title: "正在连接本地查看器…", action: nil, keyEquivalent: "")
        statusLabel.isEnabled = false
        menu.addItem(statusLabel)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "选择资源 ID…", action: #selector(selectModel), keyEquivalent: "s"))
        menu.addItem(NSMenuItem(title: "壁纸外观、尺寸与位置…", action: #selector(showLayout), keyEquivalent: ","))
        menu.addItem(NSMenuItem(title: "重新加载壁纸", action: #selector(reload), keyEquivalent: "r"))
        interactionItem = NSMenuItem(title: "启用壁纸交互", action: #selector(toggleInteraction), keyEquivalent: "i")
        menu.addItem(interactionItem)
        pauseItem = NSMenuItem(title: "暂停壁纸", action: #selector(togglePause), keyEquivalent: "p")
        menu.addItem(pauseItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "打开完整查看器", action: #selector(openViewer), keyEquivalent: "o"))
        menu.addItem(NSMenuItem(title: "在访达中显示工程", action: #selector(showProject), keyEquivalent: "f"))
        diagnosticItem = NSMenuItem(title: diagnosticsEnabled ? "关闭诊断模式" : "启用诊断模式", action: #selector(toggleDiagnostics), keyEquivalent: "d")
        diagnosticItem.state = diagnosticsEnabled ? .on : .off
        menu.addItem(diagnosticItem)
        menu.addItem(NSMenuItem(title: "打开诊断日志", action: #selector(openDiagnosticLog), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items where item.action != nil { item.target = self }
        statusItem.menu = menu
    }

    private func launchServer() {
        guard !projectRoot.isEmpty else { diagnose("server.launch-skipped", ["reason": "missing-project-root"]); return }
        diagnose("server.launch-requested")
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
        process.terminationHandler = { process in
            DiagnosticLog.shared.record("server.exited", fields: [
                "reason": process.terminationReason == .exit ? "exit" : "signal",
                "status": String(process.terminationStatus),
            ])
        }
        do {
            try process.run()
            serverProcess = process
            diagnose("server.launched", ["pid": String(process.processIdentifier)])
        } catch {
            statusLabel.title = "服务启动失败"
            let value = error as NSError
            diagnose("server.launch-failed", ["domain": value.domain, "code": String(value.code)])
        }
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
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { backgrounds = []; diagnose("backgrounds.load-failed", ["reason": "http-status"]); return }
            backgrounds = try JSONDecoder().decode(WallpaperBackgroundCatalog.self, from: data).backgrounds
            diagnose("backgrounds.loaded", ["count": String(backgrounds.count)])
        } catch {
            backgrounds = []
            let value = error as NSError
            diagnose("backgrounds.load-failed", ["domain": value.domain, "code": String(value.code)])
        }
    }

    private func wallpaperURL() -> URL {
        var parts = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "wallpaper", value: "1"), URLQueryItem(name: "fit", value: fitMode), URLQueryItem(name: "scale", value: String(scale)), URLQueryItem(name: "x", value: String(offsetX)), URLQueryItem(name: "y", value: String(offsetY)), URLQueryItem(name: "locked", value: layoutLocked ? "1" : "0"), URLQueryItem(name: "background", value: backgroundColorHex), URLQueryItem(name: "clock", value: clockEnabled ? "1" : "0"), URLQueryItem(name: "clockTheme", value: clockTheme), URLQueryItem(name: "clockScale", value: String(clockScale)), URLQueryItem(name: "clockX", value: String(clockX)), URLQueryItem(name: "clockY", value: String(clockY)), URLQueryItem(name: "clockLocked", value: clockLocked ? "1" : "0"), URLQueryItem(name: "clockPerspective", value: clockPerspective)]
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

    private func attachDiagnostics(to view: WKWebView) {
        let identifier = ObjectIdentifier(view)
        guard diagnosticsEnabled, diagnosticWebViews.insert(identifier).inserted else { return }
        let controller = view.configuration.userContentController
        controller.add(self, name: "wallpaperDiagnostics")
        controller.addUserScript(WKUserScript(source: WallpaperPageDiagnostics.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        view.navigationDelegate = self
        if view.url != nil {
            view.evaluateJavaScript(WallpaperPageDiagnostics.script) { _, error in
                guard let error else { return }
                let value = error as NSError
                DiagnosticLog.shared.record("diagnostics.script-injection-failed", fields: ["domain": value.domain, "code": String(value.code)])
            }
        }
    }

    private func detachDiagnostics(from view: WKWebView) {
        let identifier = ObjectIdentifier(view)
        guard diagnosticWebViews.remove(identifier) != nil else { return }
        let controller = view.configuration.userContentController
        view.evaluateJavaScript("window.__arkWallpaperDiagnosticsCleanup?.()")
        controller.removeScriptMessageHandler(forName: "wallpaperDiagnostics")
        controller.removeAllUserScripts()
        view.navigationDelegate = nil
    }

    private func makeWebView(frame: NSRect, label: String, reason: String) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(self, name: "wallpaperTransform")
        configuration.userContentController.add(self, name: "wallpaperClock")
        let view = WKWebView(frame: frame, configuration: configuration)
        view.setValue(false, forKey: "drawsBackground")
        view.autoresizingMask = [.width, .height]
        let identifier = ObjectIdentifier(view)
        webViewLabels[identifier] = label
        pendingNavigationReasons[identifier] = reason
        attachDiagnostics(to: view)
        diagnose("webview.created", ["view": label, "reason": reason])
        view.load(URLRequest(url: wallpaperURL()))
        return view
    }

    private func rebuildWindows(reason: String) {
        let signature = screenSignature()
        diagnose("windows.rebuild-begin", ["reason": reason, "old-count": String(windows.count), "screens": signature])
        windows.forEach { $0.close() }
        windows.removeAll()
        webViews.forEach { detachDiagnostics(from: $0) }
        webViews.removeAll()
        diagnosticWebViews.removeAll()
        webViewLabels.removeAll()
        pendingNavigationReasons.removeAll()
        for screen in NSScreen.screens {
            let label = "display-\(displayID(for: screen))"
            let window = WallpaperWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
            window.setFrame(screen.frame, display: true)
            window.level = interactionEnabled ? .normal : desktopLevel()
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
            window.backgroundColor = color(from: backgroundColorHex); window.isOpaque = true; window.hasShadow = false
            window.ignoresMouseEvents = !interactionEnabled; window.acceptsMouseMovedEvents = interactionEnabled; window.isReleasedWhenClosed = false
            window.delegate = diagnosticsEnabled ? self : nil
            let view = makeWebView(frame: NSRect(origin: .zero, size: screen.frame.size), label: label, reason: "window-rebuild:\(reason)"); window.contentView = view
            if !paused { window.orderFrontRegardless() }
            windows.append(window); webViews.append(view)
        }
        lastScreenSignature = signature
        diagnose("windows.rebuild-end", ["reason": reason, "new-count": String(windows.count)])
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let values = message.body as? [String: Any] else { return }
        if message.name == "wallpaperDiagnostics" {
            guard diagnosticsEnabled, let event = values["event"] as? String, WallpaperPageDiagnostics.allowedEvents.contains(event) else { return }
            var fields: [String: String] = ["view": message.webView.map { webViewLabels[ObjectIdentifier($0)] ?? "unknown" } ?? "unknown"]
            for key in ["navigationType", "visibility", "persisted", "prevented"] {
                if let value = values[key] { fields[key] = String(describing: value) }
            }
            diagnose("page.\(event)", fields)
            return
        }
        let defaults = UserDefaults.standard
        if message.name == "wallpaperClock" {
            if let number = values["x"] as? NSNumber { defaults.set(min(96, max(4, number.doubleValue)), forKey: "clockX") }
            if let number = values["y"] as? NSNumber { defaults.set(min(94, max(6, number.doubleValue)), forKey: "clockY") }
            applyClock()
            return
        }
        guard message.name == "wallpaperTransform" else { return }
        if let number = values["scale"] as? NSNumber { let value = min(3, max(0.25, number.doubleValue)); defaults.set(value, forKey: "scale"); scaleControl?.doubleValue = value }
        if let number = values["offsetX"] as? NSNumber { let value = min(100, max(-100, number.doubleValue)); defaults.set(value, forKey: "offsetX"); xControl?.doubleValue = value }
        if let number = values["offsetY"] as? NSNumber { let value = min(100, max(-100, number.doubleValue)); defaults.set(value, forKey: "offsetY"); yControl?.doubleValue = value }
        updateLabels()
    }

    private func label(for webView: WKWebView) -> String {
        webViewLabels[ObjectIdentifier(webView)] ?? "unknown"
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        let identifier = ObjectIdentifier(webView)
        let reason = pendingNavigationReasons.removeValue(forKey: identifier) ?? "external-or-webkit"
        diagnose("navigation.started", ["view": label(for: webView), "reason": reason])
    }

    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        diagnose("navigation.redirected", ["view": label(for: webView)])
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        diagnose("navigation.committed", ["view": label(for: webView)])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        diagnose("navigation.finished", ["view": label(for: webView)])
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let value = error as NSError
        diagnose("navigation.provisional-failed", ["view": label(for: webView), "domain": value.domain, "code": String(value.code)])
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let value = error as NSError
        diagnose("navigation.failed", ["view": label(for: webView), "domain": value.domain, "code": String(value.code)])
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        diagnose("webview.content-process-terminated", ["view": label(for: webView)])
    }

    func windowDidBecomeKey(_ notification: Notification) { diagnoseWindow("window.did-become-key", notification) }
    func windowDidResignKey(_ notification: Notification) { diagnoseWindow("window.did-resign-key", notification) }
    func windowDidChangeScreen(_ notification: Notification) { diagnoseWindow("window.did-change-screen", notification) }
    func windowDidChangeOcclusionState(_ notification: Notification) { diagnoseWindow("window.occlusion-changed", notification) }
    func windowWillClose(_ notification: Notification) { diagnoseWindow("window.will-close", notification) }

    private func diagnoseWindow(_ event: String, _ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        diagnose(event, [
            "number": String(window.windowNumber),
            "occlusion": String(window.occlusionState.rawValue),
            "visible": window.isVisible ? "true" : "false",
        ])
    }

    private func label(_ text: String, _ frame: NSRect, secondary: Bool = false) -> NSTextField {
        let value = NSTextField(labelWithString: text); value.frame = frame; value.textColor = secondary ? .secondaryLabelColor : .labelColor; value.font = secondary ? .systemFont(ofSize: 11) : .systemFont(ofSize: 12, weight: .medium); return value
    }
    @objc private func showLayout() {
        if let settingsPanel { NSApp.activate(ignoringOtherApps: true); settingsPanel.makeKeyAndOrderFront(nil); return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 730), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "壁纸外观、尺寸与位置"; panel.isFloatingPanel = true; panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false; panel.level = .floating; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; panel.center()
        let content = NSView(frame: panel.contentView?.bounds ?? .zero); panel.contentView = content
        content.addSubview(label("桌面时钟", NSRect(x: 24, y: 682, width: 120, height: 20)))
        let clockVisible = NSButton(checkboxWithTitle: "显示桌面时钟", target: self, action: #selector(clockChanged)); clockVisible.frame = NSRect(x: 141, y: 641, width: 276, height: 24); clockVisible.state = clockEnabled ? .on : .off; content.addSubview(clockVisible)
        content.addSubview(label("时钟主题", NSRect(x: 24, y: 602, width: 110, height: 20)))
        let clockThemeSelector = NSPopUpButton(frame: NSRect(x: 145, y: 596, width: 270, height: 28)); clockThemeSelector.addItems(withTitles: clockThemeLabels); clockThemeSelector.selectItem(at: clockThemeKeys.firstIndex(of: clockTheme) ?? 0); clockThemeSelector.target = self; clockThemeSelector.action = #selector(clockChanged); content.addSubview(clockThemeSelector)
        content.addSubview(label("时钟尺寸", NSRect(x: 24, y: 562, width: 110, height: 20)))
        let clockScaleSlider = NSSlider(value: clockScale, minValue: 0.5, maxValue: 2, target: self, action: #selector(clockChanged)); clockScaleSlider.frame = NSRect(x: 145, y: 560, width: 210, height: 24); clockScaleSlider.isContinuous = true; content.addSubview(clockScaleSlider)
        let clockScaleValue = label("", NSRect(x: 365, y: 562, width: 52, height: 20), secondary: true); clockScaleValue.alignment = .right; content.addSubview(clockScaleValue)
        let clockLock = NSButton(checkboxWithTitle: "锁定位置", target: self, action: #selector(clockChanged)); clockLock.frame = NSRect(x: 141, y: 517, width: 100, height: 24); clockLock.state = clockLocked ? .on : .off; content.addSubview(clockLock)
        let clockPerspectiveSelector = NSPopUpButton(frame: NSRect(x: 258, y: 513, width: 157, height: 28)); clockPerspectiveSelector.addItems(withTitles: clockPerspectiveLabels); clockPerspectiveSelector.selectItem(at: clockPerspectiveKeys.firstIndex(of: clockPerspective) ?? 0); clockPerspectiveSelector.target = self; clockPerspectiveSelector.action = #selector(clockChanged); content.addSubview(clockPerspectiveSelector)
        let clockHint = label("启用壁纸交互并取消锁定后，可直接拖动时钟；位置会自动保存。", NSRect(x: 24, y: 477, width: 392, height: 30), secondary: true); clockHint.maximumNumberOfLines = 2; content.addSubview(clockHint)
        content.addSubview(label("壁纸外观", NSRect(x: 24, y: 430, width: 120, height: 20)))
        content.addSubview(label("背景图", NSRect(x: 24, y: 395, width: 110, height: 20)))
        let backgroundImage = NSPopUpButton(frame: NSRect(x: 145, y: 389, width: 270, height: 28)); backgroundImage.addItem(withTitle: "无（仅背景色）"); backgroundImage.addItems(withTitles: backgrounds.map(\.name)); backgroundImage.selectItem(at: (backgrounds.firstIndex(where: { $0.id == backgroundImageID }).map { $0 + 1 }) ?? 0); backgroundImage.target = self; backgroundImage.action = #selector(backgroundImageChanged); content.addSubview(backgroundImage)
        content.addSubview(label("背景颜色", NSRect(x: 24, y: 354, width: 110, height: 20)))
        let backgroundColor = NSColorWell(frame: NSRect(x: 145, y: 348, width: 72, height: 28)); backgroundColor.color = color(from: backgroundColorHex); backgroundColor.target = self; backgroundColor.action = #selector(backgroundColorChanged); backgroundColor.isContinuous = true; content.addSubview(backgroundColor)
        NSColorPanel.shared.showsAlpha = false
        content.addSubview(label("尺寸与位置", NSRect(x: 24, y: 309, width: 120, height: 20)))
        content.addSubview(label("填充模式", NSRect(x: 24, y: 273, width: 110, height: 20)))
        let fit = NSPopUpButton(frame: NSRect(x: 145, y: 267, width: 270, height: 28)); fit.addItems(withTitles: fitLabels); fit.selectItem(at: fitKeys.firstIndex(of: fitMode) ?? 1); fit.target = self; fit.action = #selector(layoutChanged); content.addSubview(fit)
        content.addSubview(label("缩放", NSRect(x: 24, y: 231, width: 110, height: 20)))
        let scaleSlider = NSSlider(value: scale, minValue: 0.25, maxValue: 3, target: self, action: #selector(layoutChanged)); scaleSlider.frame = NSRect(x: 145, y: 229, width: 210, height: 24); scaleSlider.isContinuous = true; content.addSubview(scaleSlider)
        let scaleValue = label("", NSRect(x: 365, y: 231, width: 52, height: 20), secondary: true); scaleValue.alignment = .right; content.addSubview(scaleValue)
        content.addSubview(label("水平位置", NSRect(x: 24, y: 189, width: 110, height: 20)))
        let xSlider = NSSlider(value: offsetX, minValue: -100, maxValue: 100, target: self, action: #selector(layoutChanged)); xSlider.frame = NSRect(x: 145, y: 187, width: 210, height: 24); xSlider.isContinuous = true; content.addSubview(xSlider)
        let xValue = label("", NSRect(x: 365, y: 189, width: 52, height: 20), secondary: true); xValue.alignment = .right; content.addSubview(xValue)
        content.addSubview(label("垂直位置", NSRect(x: 24, y: 147, width: 110, height: 20)))
        let ySlider = NSSlider(value: offsetY, minValue: -100, maxValue: 100, target: self, action: #selector(layoutChanged)); ySlider.frame = NSRect(x: 145, y: 145, width: 210, height: 24); ySlider.isContinuous = true; content.addSubview(ySlider)
        let yValue = label("", NSRect(x: 365, y: 147, width: 52, height: 20), secondary: true); yValue.alignment = .right; content.addSubview(yValue)
        let lock = NSButton(checkboxWithTitle: "锁定壁纸尺寸与位置（防止交互时误拖动）", target: self, action: #selector(layoutChanged)); lock.frame = NSRect(x: 141, y: 105, width: 276, height: 24); lock.state = layoutLocked ? .on : .off; content.addSubview(lock)
        let hint = label("解锁后可在交互模式中拖动壁纸或用滚轮缩放；所有调整会自动保存。", NSRect(x: 24, y: 66, width: 392, height: 30), secondary: true); hint.maximumNumberOfLines = 2; content.addSubview(hint)
        let reset = NSButton(title: "恢复默认", target: self, action: #selector(resetLayout)); reset.frame = NSRect(x: 24, y: 22, width: 96, height: 32); content.addSubview(reset)
        let done = NSButton(title: "完成", target: self, action: #selector(closeLayout)); done.keyEquivalent = "\r"; done.frame = NSRect(x: 320, y: 22, width: 96, height: 32); content.addSubview(done)
        settingsPanel = panel; fitControl = fit; scaleControl = scaleSlider; xControl = xSlider; yControl = ySlider; lockControl = lock; backgroundColorControl = backgroundColor; backgroundImageControl = backgroundImage; clockEnabledControl = clockVisible; clockThemeControl = clockThemeSelector; clockScaleControl = clockScaleSlider; clockLockControl = clockLock; clockPerspectiveControl = clockPerspectiveSelector; clockScaleLabel = clockScaleValue; scaleLabel = scaleValue; xLabel = xValue; yLabel = yValue; updateLabels()
        NSApp.activate(ignoringOtherApps: true); panel.orderFrontRegardless(); panel.makeKey()
    }
    private func updateLabels() { clockScaleLabel?.stringValue = String(format: "%.0f%%", (clockScaleControl?.doubleValue ?? 1) * 100); scaleLabel?.stringValue = String(format: "%.0f%%", (scaleControl?.doubleValue ?? 1) * 100); xLabel?.stringValue = String(format: "%+.0f%%", xControl?.doubleValue ?? 0); yLabel?.stringValue = String(format: "%+.0f%%", yControl?.doubleValue ?? 0) }
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
    @objc private func clockChanged() {
        guard let clockEnabledControl, let clockThemeControl, let clockScaleControl, let clockLockControl, let clockPerspectiveControl else { return }
        let defaults = UserDefaults.standard
        defaults.set(clockEnabledControl.state == .on, forKey: "clockEnabled")
        defaults.set(clockThemeKeys[max(0, clockThemeControl.indexOfSelectedItem)], forKey: "clockTheme")
        defaults.set(clockScaleControl.doubleValue, forKey: "clockScale")
        defaults.set(clockLockControl.state == .on, forKey: "clockLocked")
        defaults.set(clockPerspectiveKeys[max(0, clockPerspectiveControl.indexOfSelectedItem)], forKey: "clockPerspective")
        applyClock()
    }
    private func applyClock() {
        let values: [String: Any] = ["enabled": clockEnabled, "theme": clockTheme, "scale": clockScale, "x": clockX, "y": clockY, "locked": clockLocked, "perspective": clockPerspective]
        guard let data = try? JSONSerialization.data(withJSONObject: values), let json = String(data: data, encoding: .utf8) else { return }
        webViews.forEach { $0.evaluateJavaScript("window.__setWallpaperClock?.(\(json))") }
    }
    @objc private func resetLayout() { fitControl?.selectItem(at: 1); scaleControl?.doubleValue = 1; xControl?.doubleValue = 0; yControl?.doubleValue = 0; lockControl?.state = .on; backgroundColorControl?.color = .black; backgroundImageControl?.selectItem(at: 0); clockEnabledControl?.state = .on; clockThemeControl?.selectItem(at: 0); clockScaleControl?.doubleValue = 1; clockLockControl?.state = .on; clockPerspectiveControl?.selectItem(at: 0); UserDefaults.standard.set(82, forKey: "clockX"); UserDefaults.standard.set(18, forKey: "clockY"); layoutChanged(); backgroundColorChanged(); backgroundImageChanged(); clockChanged() }
    @objc private func closeLayout() { settingsPanel?.orderOut(nil) }

    @objc private func selectModel() {
        NSApp.activate(ignoringOtherApps: true)
        let input = NSTextField(string: modelID); input.placeholderString = "查看器中的 16 位资源 ID"; input.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
        let alert = NSAlert(); alert.messageText = "选择壁纸资源"; alert.informativeText = "从完整查看器的 Model Inspector 复制动态或静态资源 ID；留空则自动选择第一个可用资源。"; alert.accessoryView = input; alert.addButton(withTitle: "应用"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let value = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.isEmpty || value.range(of: "^[0-9a-f]{16}$", options: .regularExpression) != nil else { NSSound.beep(); return }
        UserDefaults.standard.set(value, forKey: "modelID"); statusLabel.title = value.isEmpty ? "运行中 · 自动选择首个模型" : "运行中 · \(value)"; reloadViews(reason: "model-selection")
    }
    private func reloadViews(reason: String) {
        diagnose("views.reload-requested", ["reason": reason, "count": String(webViews.count)])
        let request = URLRequest(url: wallpaperURL(), cachePolicy: .reloadIgnoringLocalCacheData)
        webViews.forEach {
            pendingNavigationReasons[ObjectIdentifier($0)] = reason
            $0.load(request)
        }
    }
    @objc private func reload() {
        diagnose("menu.reload-selected")
        Task {
            if !(await serverReady()) { launchServer(); _ = await waitForServer() }
            if windows.isEmpty { rebuildWindows(reason: "manual-reload-empty") } else { reloadViews(reason: "manual-menu") }
        }
    }
    @objc private func screensChanged() {
        let current = screenSignature()
        diagnose("screens.parameters-notification", ["before": lastScreenSignature, "after": current])
        guard lastScreenSignature.isEmpty || current != lastScreenSignature else {
            diagnose("screens.rebuild-skipped", ["reason": "unchanged-signature"])
            return
        }
        rebuildWindows(reason: "screen-parameters-changed")
    }
    @objc private func toggleInteraction() {
        interactionEnabled.toggle()
        diagnose("interaction.changed", ["enabled": interactionEnabled ? "true" : "false"])
        interactionItem.state = interactionEnabled ? .on : .off
        interactionItem.title = interactionEnabled ? "结束壁纸交互" : "启用壁纸交互"
        for window in windows {
            window.ignoresMouseEvents = !interactionEnabled
            window.acceptsMouseMovedEvents = interactionEnabled
            window.level = interactionEnabled ? .normal : desktopLevel()
            if interactionEnabled { window.makeKeyAndOrderFront(nil) } else { window.orderFrontRegardless() }
        }
        if interactionEnabled { NSApp.activate(ignoringOtherApps: true) }
    }
    @objc private func togglePause() {
        paused.toggle()
        diagnose("pause.changed", ["paused": paused ? "true" : "false"])
        pauseItem.state = paused ? .on : .off
        pauseItem.title = paused ? "继续壁纸" : "暂停壁纸"
        if paused { windows.forEach { $0.orderOut(nil) } } else { windows.forEach { $0.orderFrontRegardless() } }
    }
    @objc private func toggleDiagnostics() {
        diagnosticsEnabled.toggle()
        UserDefaults.standard.set(diagnosticsEnabled, forKey: "diagnosticsEnabled")
        if diagnosticsEnabled {
            DiagnosticLog.shared.setEnabled(true)
            setWorkspaceDiagnosticsEnabled(true)
            windows.forEach { $0.delegate = self }
            webViews.forEach { attachDiagnostics(to: $0) }
            diagnose("diagnostics.enabled", ["screens": screenSignature(), "views": String(webViews.count)])
        } else {
            diagnose("diagnostics.disabled")
            setWorkspaceDiagnosticsEnabled(false)
            windows.forEach { $0.delegate = nil }
            webViews.forEach { detachDiagnostics(from: $0) }
            DiagnosticLog.shared.flush()
            DiagnosticLog.shared.setEnabled(false)
        }
        diagnosticItem.state = diagnosticsEnabled ? .on : .off
        diagnosticItem.title = diagnosticsEnabled ? "关闭诊断模式" : "启用诊断模式"
    }
    @objc private func openDiagnosticLog() {
        let url = DiagnosticLog.shared.fileURL
        DiagnosticLog.shared.flush()
        guard FileManager.default.fileExists(atPath: url.path) else {
            NSApp.activate(ignoringOtherApps: true)
            let alert = NSAlert()
            alert.messageText = "尚无诊断日志"
            alert.informativeText = "请先启用诊断模式并复现问题。诊断模式默认关闭。"
            alert.runModal()
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
    @objc private func openViewer() { NSWorkspace.shared.open(serverURL) }
    @objc private func showProject() { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: projectRoot, isDirectory: true)]) }
    @objc private func showStartupError() { statusLabel.title = "无法启动本地服务"; NSApp.activate(ignoringOtherApps: true); let alert = NSAlert(); alert.messageText = "无法启动 Arknights 本地查看器"; alert.informativeText = "请确认工程目录和 runtime.local.json 中的资源路径有效。"; alert.alertStyle = .critical; alert.runModal() }
    @objc private func quit() { NSApp.terminate(nil) }
}

@main
struct ArknightsWallpaperApp {
    static func main() { let application = NSApplication.shared; let delegate = AppDelegate(); application.delegate = delegate; application.run() }
}
