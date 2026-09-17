import Foundation

final class DiagnosticLog: @unchecked Sendable {
    static let shared = DiagnosticLog()

    let fileURL: URL
    private let previousFileURL: URL
    private let stateLock = NSLock()
    private let queue = DispatchQueue(label: "local.ark-wallpaper.diagnostics", qos: .utility)
    private let formatter = ISO8601DateFormatter()
    private let sessionID = String(UUID().uuidString.prefix(8)).lowercased()
    private let maximumBytes: UInt64 = 4 * 1024 * 1024
    private var enabled = false

    private init() {
        let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        let directory = library.appendingPathComponent("Logs/Ark-Wallpaper", isDirectory: true)
        fileURL = directory.appendingPathComponent("wallpaper.log")
        previousFileURL = directory.appendingPathComponent("wallpaper.previous.log")
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func setEnabled(_ value: Bool) {
        stateLock.lock()
        let changed = enabled != value
        enabled = value
        stateLock.unlock()
        guard changed, value else { return }
        record("session.start", fields: [
            "pid": String(ProcessInfo.processInfo.processIdentifier),
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
        ])
    }

    func record(_ event: String, fields: [String: String] = [:]) {
        stateLock.lock()
        let shouldRecord = enabled
        stateLock.unlock()
        guard shouldRecord else { return }
        queue.async { [event, fields] in self.append(event, fields: fields) }
    }

    func flush() {
        queue.sync {}
    }

    private func append(_ event: String, fields: [String: String]) {
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        rotateIfNeeded()
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }
        let values = fields.keys.sorted().map { "\($0)=\(sanitize(fields[$0] ?? ""))" }
        let suffix = values.isEmpty ? "" : " " + values.joined(separator: " ")
        let line = "\(formatter.string(from: Date())) session=\(sessionID) event=\(sanitize(event))\(suffix)\n"
        guard let data = line.data(using: .utf8), let handle = try? FileHandle(forWritingTo: fileURL) else { return }
        handle.seekToEndOfFile()
        handle.write(data)
        handle.synchronizeFile()
        handle.closeFile()
    }

    private func rotateIfNeeded() {
        guard
            let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
            let size = attributes[.size] as? NSNumber,
            size.uint64Value >= maximumBytes
        else { return }
        try? FileManager.default.removeItem(at: previousFileURL)
        try? FileManager.default.moveItem(at: fileURL, to: previousFileURL)
    }

    private func sanitize(_ value: String) -> String {
        let compact = value
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\t", with: "\\t")
            .replacingOccurrences(of: " ", with: "_")
        return String(compact.prefix(240))
    }
}

enum WallpaperPageDiagnostics {
    static let allowedEvents: Set<String> = [
        "script-start", "dom-content-loaded", "load", "pageshow", "pagehide",
        "beforeunload", "visibility-change", "freeze", "resume",
        "webgl-context-lost", "webgl-context-restored", "window-error", "unhandled-rejection",
    ]

    static let script = #"""
    (() => {
      window.__arkWallpaperDiagnosticsCleanup?.();
      const listeners = [];
      const on = (target, event, listener, options) => {
        target.addEventListener(event, listener, options);
        listeners.push(() => target.removeEventListener(event, listener, options));
      };
      const send = (event, details = {}) => {
        try {
          window.webkit?.messageHandlers?.wallpaperDiagnostics?.postMessage({ event, ...details });
        } catch (_) {}
      };
      window.__arkWallpaperDiagnosticsCleanup = () => {
        listeners.splice(0).forEach((remove) => remove());
        delete window.__arkWallpaperDiagnosticsCleanup;
      };
      const navigation = performance.getEntriesByType?.("navigation")?.[0];
      send("script-start", { navigationType: navigation?.type || "unknown", visibility: document.visibilityState });
      on(document, "DOMContentLoaded", () => send("dom-content-loaded"), { once: true });
      on(window, "load", () => send("load"), { once: true });
      on(window, "pageshow", (event) => send("pageshow", { persisted: !!event.persisted }));
      on(window, "pagehide", (event) => send("pagehide", { persisted: !!event.persisted }));
      on(window, "beforeunload", () => send("beforeunload"));
      on(document, "visibilitychange", () => send("visibility-change", { visibility: document.visibilityState }));
      on(document, "freeze", () => send("freeze"));
      on(document, "resume", () => send("resume"));
      on(window, "webglcontextlost", (event) => send("webgl-context-lost", { prevented: event.defaultPrevented }), true);
      on(window, "webglcontextrestored", () => send("webgl-context-restored"), true);
      on(window, "error", () => send("window-error"));
      on(window, "unhandledrejection", () => send("unhandled-rejection"));
    })();
    """#
}
