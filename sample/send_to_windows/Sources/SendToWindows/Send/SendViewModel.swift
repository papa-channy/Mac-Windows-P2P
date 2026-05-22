// SendViewModel.swift — Send 화면 상태 + Engine 호출 orchestration.

import Foundation
import AppKit
import TransferCore

@MainActor
public final class SendViewModel: ObservableObject {

    public struct QueueItem: Identifiable, Hashable {
        public let id = UUID()
        public let url: URL
        public let isDirectory: Bool
        public let sizeBytes: Int64
    }

    @Published public var queue: [QueueItem] = []
    @Published public var category: TransferCategory = Categories.unsorted
    @Published public var isSending: Bool = false
    @Published public var lastError: String?
    @Published public var lastOutcome: BatchOutcome?

    public init() {}

    // MARK: — 큐 조작

    public func enqueue(urls: [URL]) {
        for url in urls {
            // 중복 방지
            if queue.contains(where: { $0.url.standardizedFileURL == url.standardizedFileURL }) {
                continue
            }
            let (isDir, size) = inspect(url)
            queue.append(QueueItem(url: url, isDirectory: isDir, sizeBytes: size))
        }
    }

    public func remove(_ item: QueueItem) {
        queue.removeAll { $0.id == item.id }
    }

    public func clear() {
        queue.removeAll()
    }

    public var totalBytes: Int64 {
        queue.reduce(0) { $0 + $1.sizeBytes }
    }

    // MARK: — 전송

    public func send() async {
        guard !queue.isEmpty, !isSending else { return }
        isSending = true
        defer { isSending = false }
        lastError = nil
        lastOutcome = nil

        // 셰어 마운트 확보 (background thread에서 호출 — 메인 블록 회피)
        let mountURL: URL? = await Task.detached { ShareMount.ensureMounted() }.value
        guard let shareRoot = mountURL else {
            lastError = "셰어를 마운트할 수 없습니다 (mw mount 실패)"
            return
        }

        let urls = queue.map(\.url)
        let cat = category
        let host = Host.current().localizedName ?? "Mac"
        let user = NSUserName()

        let result: Result<BatchOutcome, Error> = await Task.detached {
            do {
                let req = BatchRequest(
                    items: urls, category: cat, direction: .macToWindows,
                    shareRoot: shareRoot, sourceHost: host, sourceUser: user,
                    batchName: nil, version: 1, overwriteIfExists: false
                )
                let outcome = try TransferEngine.sendBatch(req)
                return .success(outcome)
            } catch {
                return .failure(error)
            }
        }.value

        switch result {
        case .success(let outcome):
            lastOutcome = outcome
            queue.removeAll()  // 송신 성공 시 큐 비움
        case .failure(let err):
            lastError = errorMessage(err)
        }
    }

    // MARK: — Internal

    private func inspect(_ url: URL) -> (isDirectory: Bool, sizeBytes: Int64) {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        _ = fm.fileExists(atPath: url.path, isDirectory: &isDir)
        let dir = isDir.boolValue
        let size: Int64
        if dir {
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

    private func errorMessage(_ err: Error) -> String {
        if let te = err as? TransferError {
            return te.description
        }
        return "\(err)"
    }
}
