// App.swift — @main 진입점 + 런치 모드 분기.
//
// 두 가지 모드:
//   1) 명령행에 파일 경로(들) → SendDialog 모드 (Quick Action 우클릭 진입)
//   2) 인자 없음 → Home 모드 (Phase 3에서 본격 구현; 지금은 placeholder)
//
// AppKit NSApplicationMain + custom borderless NSWindow로 dialog chrome 컨트롤.

import AppKit
import SwiftUI
import TransferCore

@main
enum SendToWindowsApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)  // Dock 아이콘 X (dialog UX); 필요시 .regular로
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var serviceProvider: SendServiceProvider?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Services 메뉴 vendor 등록 — Finder 우클릭 → "Services > Windows로 보내기" 노출
        let provider = SendServiceProvider { [weak self] url in
            DispatchQueue.main.async { self?.presentSendFlow(for: url) }
        }
        self.serviceProvider = provider
        NSApp.servicesProvider = provider
        NSUpdateDynamicServices()

        let urls = collectInputURLs(from: CommandLine.arguments)
        if let first = urls.first {
            presentSendFlow(for: first)
        } else if !ProcessInfo.processInfo.environment.keys.contains(
            "SENDTOWINDOWS_SERVICE_VENDOR_ONLY")
        {
            // 사용자가 .app을 직접 더블클릭한 케이스 — Home placeholder
            presentHomePlaceholder()
        }
        // Service 호출 케이스: provider가 callback으로 presentSendFlow 호출하면서 윈도우 띄움
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: — Args

    /// 명령행 인자 중 실제 존재하는 파일/디렉터리 경로만 추출.
    /// Quick Action이 여러 개 넘겨도 Phase 2에선 첫 번째만 사용.
    private func collectInputURLs(from args: [String]) -> [URL] {
        let fm = FileManager.default
        return args.dropFirst().compactMap { raw in
            // 절대경로 또는 file:// URL 둘 다 허용
            if raw.hasPrefix("file://"), let u = URL(string: raw) { return u }
            let path = (raw as NSString).standardizingPath
            return fm.fileExists(atPath: path) ? URL(fileURLWithPath: path) : nil
        }
    }

    // MARK: — Send 플로우

    private func presentSendFlow(for url: URL) {
        let (isDir, size) = inspect(url: url)
        let view = SendDialog(
            item: url,
            isDirectory: isDir,
            sizeBytes: size,
            onCancel: { [weak self] in self?.close() },
            onSend:   { [weak self] cat in self?.performSend(url: url, isDir: isDir,
                                                             category: cat) }
        )
        present(rootView: AnyView(view))
    }

    private func performSend(url: URL, isDir: Bool, category: TransferCategory) {
        // 셰어 마운트 보장
        guard let shareRoot = ShareMount.ensureMounted() else {
            presentError(title: "셰어를 마운트할 수 없습니다",
                         message: "데스크탑의 Mac-Window_Share.app으로 마운트 상태를 확인해주세요.")
            return
        }

        let req = TransferRequest(
            sourceURL: url, category: category, direction: .macToWindows,
            shareRoot: shareRoot,
            sourceHost: Host.current().localizedName ?? "Mac",
            sourceUser: NSUserName(),
            batchName: nil, version: 1,
            overwriteIfExists: false
        )
        do {
            let outcome = try TransferEngine.send(req)
            presentResult(outcome: outcome, category: category)
        } catch let TransferError.destinationExists(path) {
            // 덮어쓰기 확인 다이얼로그로 교체
            present(rootView: AnyView(OverwriteDialog(
                existingPath: path,
                onCancel: { [weak self] in self?.close() },
                onOverwrite: { [weak self] in
                    self?.performSendForceOverwrite(url: url, isDir: isDir, category: category,
                                                    shareRoot: shareRoot)
                }
            )))
        } catch let TransferError.rawSecretBlocked(name, rule, pattern) {
            presentError(
                title: "차단됨 — 시크릿 파일은 보낼 수 없습니다",
                message: "\(name)\n룰: \(rule)\n패턴: \(pattern)\n\n.env.example / 1Password / Doppler 등을 사용해주세요."
            )
        } catch {
            presentError(title: "전송 실패", message: "\(error)")
        }
    }

    private func performSendForceOverwrite(url: URL, isDir: Bool,
                                           category: TransferCategory,
                                           shareRoot: URL) {
        let req = TransferRequest(
            sourceURL: url, category: category, direction: .macToWindows,
            shareRoot: shareRoot,
            sourceHost: Host.current().localizedName ?? "Mac",
            sourceUser: NSUserName(),
            batchName: nil, version: 1,
            overwriteIfExists: true
        )
        do {
            let outcome = try TransferEngine.send(req)
            presentResult(outcome: outcome, category: category)
        } catch {
            presentError(title: "덮어쓰기 실패", message: "\(error)")
        }
    }

    private func presentResult(outcome: TransferOutcome, category: TransferCategory) {
        let view = ResultDialog(
            primaryFilename: outcome.destinationURL.lastPathComponent
                .precomposedStringWithCanonicalMapping,
            category: category,
            sha256: outcome.sha256,
            onConfirm: { [weak self] in self?.close() }
        )
        present(rootView: AnyView(view))
    }

    private func presentError(title: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "확인")
        if let w = window {
            alert.beginSheetModal(for: w) { [weak self] _ in self?.close() }
        } else {
            alert.runModal()
            close()
        }
    }

    // MARK: — Home + 화면 라우팅 (Phase 3)

    private func presentHomePlaceholder() {
        presentHome()
    }

    private func presentHome() {
        let view = HomeView(
            onPick: { [weak self] dest in self?.route(to: dest) },
            onQuit: { [weak self] in self?.close() }
        )
        present(rootView: AnyView(view), size: CGSize(width: 720, height: 460))
    }

    private func route(to dest: HomeDestination) {
        switch dest {
        case .send:
            let view = SendView(
                onBack: { [weak self] in self?.presentHome() },
                onQuit: { [weak self] in self?.close() }
            )
            present(rootView: AnyView(view), size: CGSize(width: 980, height: 600))
        case .received:
            let view = ReceivedView(
                onBack: { [weak self] in self?.presentHome() },
                onQuit: { [weak self] in self?.close() }
            )
            present(rootView: AnyView(view), size: CGSize(width: 720, height: 460))
        case .sent:
            let view = SentView(
                onBack: { [weak self] in self?.presentHome() },
                onQuit: { [weak self] in self?.close() }
            )
            present(rootView: AnyView(view), size: CGSize(width: 760, height: 520))
        }
    }

    // MARK: — Window 관리

    private func present(rootView: AnyView,
                         size: CGSize = CGSize(width: Theme.Layout.dialogWidth,
                                               height: 360)) {
        let host = NSHostingController(rootView: rootView)
        if let w = window {
            // 콘텐츠 교체 + 사이즈 변화: **top-left 코너 유지** (macOS 표준 resize 동작).
            // 이전엔 center를 유지해서 큰→작은 전환에 윈도우가 점프하는 것처럼 보였음.
            w.contentViewController = host
            let oldFrame = w.frame
            let newOrigin = NSPoint(
                x: oldFrame.minX,                    // 좌측 가장자리 고정
                y: oldFrame.maxY - size.height       // top-left 유지 (NSRect 원점=bottom-left)
            )
            let newFrame = NSRect(origin: newOrigin, size: size)
            w.setFrame(newFrame, display: true, animate: true)
            return
        }
        let w = makeBorderlessWindow(size: size)
        w.contentViewController = host
        w.center()
        w.level = .floating
        w.makeKeyAndOrderFront(nil)
        self.window = w
    }

    private func makeBorderlessWindow(size: CGSize) -> NSWindow {
        let style: NSWindow.StyleMask = [.borderless, .fullSizeContentView]
        let w = NSWindow(
            contentRect: .init(origin: .zero, size: size),
            styleMask: style, backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = true
        w.isMovableByWindowBackground = false  // 헤더 영역에서만 드래그
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        w.collectionBehavior.insert(.fullScreenAuxiliary)
        return w
    }

    private func close() {
        window?.orderOut(nil)
        window = nil
        // accessory 앱이라 종료. (Service 재사용 위해선 살려둘 수도 있지만 phase 2는 단순.)
        NSApp.terminate(nil)
    }

    fileprivate func handleServiceInvocation(url: URL) {
        presentSendFlow(for: url)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: — Inspect URL

    private func inspect(url: URL) -> (isDirectory: Bool, sizeBytes: Int64) {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        _ = fm.fileExists(atPath: url.path, isDirectory: &isDir)
        let dir = isDir.boolValue
        let size: Int64
        if dir {
            // 폴더 사이즈: walk 합. 큰 폴더는 비싸지만 phase 2는 단순 표시 용도.
            size = folderSize(url: url)
        } else {
            let attrs = (try? fm.attributesOfItem(atPath: url.path)) ?? [:]
            size = (attrs[.size] as? Int64) ?? 0
        }
        return (dir, size)
    }

    private func folderSize(url: URL) -> Int64 {
        let fm = FileManager.default
        guard let en = fm.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey],
                                     options: [.skipsHiddenFiles]) else { return 0 }
        var total: Int64 = 0
        for case let u as URL in en {
            if let s = (try? u.resourceValues(forKeys: [.fileSizeKey]))?.fileSize {
                total += Int64(s)
            }
        }
        return total
    }
}

// MARK: — Services menu vendor

/// macOS Services 메뉴 ("Windows로 보내기") 핸들러.
/// Finder/ForkLift 등 NSPasteboard-based file Services를 지원하는 모든 앱에서 자동 노출.
final class SendServiceProvider: NSObject {
    private let onURL: (URL) -> Void
    init(onURL: @escaping (URL) -> Void) { self.onURL = onURL }

    /// Info.plist의 NSMessage = "handleSendService" 와 매칭.
    /// 서명은 `<NSMessage>:userData:error:`. AppKit이 자동 호출.
    @objc func handleSendService(_ pasteboard: NSPasteboard,
                                 userData: String?,
                                 error: AutoreleasingUnsafeMutablePointer<NSString>) {
        let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL] ?? []
        // Phase 2: 첫 항목만 처리 (다중은 Phase 3 batch 모드)
        guard let first = urls.first else {
            error.pointee = "선택된 파일이 없습니다." as NSString
            return
        }
        onURL(first)
    }
}

// Home/Send/Received/Sent 화면은 별도 파일에 정의됨.
