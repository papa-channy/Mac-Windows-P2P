// main.swift — accessory app that vendors a macOS Service. On invocation,
// it reads the selected file URLs from the system pasteboard, spawns the
// Tauri share-manager binary with `--send <path>` arguments, and exits.
//
// The .app's Info.plist declares the NSServices entry (see Resources/).

import AppKit
import Foundation

// Where to find the Tauri binary, in priority order:
//   1. SHARE_MANAGER_BIN env (test override)
//   2. /Applications/share-manager.app/Contents/MacOS/share-manager
//   3. ~/Applications/share-manager.app/Contents/MacOS/share-manager
//   4. PATH lookup of `share-manager`
func resolveShareManagerBinary() -> URL? {
    if let env = ProcessInfo.processInfo.environment["SHARE_MANAGER_BIN"],
       FileManager.default.isExecutableFile(atPath: env) {
        return URL(fileURLWithPath: env)
    }
    let candidates = [
        "/Applications/share-manager.app/Contents/MacOS/share-manager",
        "\(NSHomeDirectory())/Applications/share-manager.app/Contents/MacOS/share-manager",
    ]
    for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
        return URL(fileURLWithPath: path)
    }
    if let path = ProcessInfo.processInfo.environment["PATH"]?.split(separator: ":") {
        for dir in path {
            let p = "\(dir)/share-manager"
            if FileManager.default.isExecutableFile(atPath: p) {
                return URL(fileURLWithPath: p)
            }
        }
    }
    return nil
}

func launch(with urls: [URL]) {
    guard !urls.isEmpty else { return }
    guard let bin = resolveShareManagerBinary() else {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "share-manager 앱을 찾지 못했어요"
        alert.informativeText = "/Applications 또는 ~/Applications 에 share-manager.app 을 설치하세요."
        alert.runModal()
        return
    }
    var args: [String] = []
    for url in urls {
        args.append("--send-now")
        args.append(url.path)
    }
    let task = Process()
    task.executableURL = bin
    task.arguments = args
    do {
        try task.run()
    } catch {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "실행 실패"
        alert.informativeText = "\(error)"
        alert.runModal()
    }
}

// MARK: — Services vendor

final class ServiceProvider: NSObject {
    /// Bound to `NSMessage = handleSendService` in Info.plist.
    @objc func handleSendService(_ pasteboard: NSPasteboard,
                                 userData: String?,
                                 error errPtr: AutoreleasingUnsafeMutablePointer<NSString>) {
        let urls = (pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL]) ?? []
        guard !urls.isEmpty else {
            errPtr.pointee = "선택된 파일이 없습니다." as NSString
            return
        }
        launch(with: urls)
    }
}

final class LauncherDelegate: NSObject, NSApplicationDelegate {
    let provider = ServiceProvider()

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.servicesProvider = provider
        NSUpdateDynamicServices()

        // Allow command-line invocation: `SendToWindowsLauncher /path/to/file [...]`
        let args = CommandLine.arguments.dropFirst()
        let cliURLs: [URL] = args.compactMap { raw in
            let path = (raw as NSString).standardizingPath
            return FileManager.default.fileExists(atPath: path)
                ? URL(fileURLWithPath: path) : nil
        }
        if !cliURLs.isEmpty {
            launch(with: cliURLs)
            NSApp.terminate(nil)
            return
        }
        // No CLI args: stay alive briefly so Services menu can dispatch into us
        // when launched at login. The Service callback will spawn the Tauri
        // binary and we exit immediately.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            // If we were launched purely to register the vendor, exit. If a
            // Service is invoked before this fires, the callback's spawn is
            // already enqueued.
            NSApp.terminate(nil)
        }
    }
}

let app = NSApplication.shared
let delegate = LauncherDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
