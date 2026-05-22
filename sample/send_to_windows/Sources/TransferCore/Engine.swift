// Engine.swift — TransferEngine orchestrator (Phase 1).
//
// 단일 파일 / 단일 폴더 송신:
//   1. RAW_SECRET 검사 (파일명; 폴더면 폴더명 + 내부 파일들 walk)
//   2. 네이밍 적용 → 최종 파일/폴더명
//   3. 도착지 경로 계산 (셰어/방향/카테고리)
//   4. 덮어쓰기 — 이미 있으면 .destinationExists 신호 던짐 (UI에서 confirm)
//   5. 파일 복사 (원자성: 임시 이름으로 복사 → rename)
//   6. SHA-256 계산 (파일 또는 dir-hash)
//   7. Manifest / Sidecar / Log 생성 → 셰어의 적절한 위치에 atomic write
//   8. TransferOutcome 반환
//
// Phase 3에서 batch 모드 (다중 drag-drop) 추가 예정.

import Foundation

public struct TransferRequest: Sendable {
    public var sourceURL: URL              // 원본 (파일 또는 폴더)
    public var category: TransferCategory
    public var direction: TransferDirection
    public var shareRoot: URL              // /Volumes/Mac-Window_Share 등
    public var sourceHost: String
    public var sourceUser: String
    public var batchName: String?          // nil이면 basename에서 자동 도출
    public var version: Int
    public var overwriteIfExists: Bool     // false면 destinationExists 신호; true면 덮어쓰기
    public var now: Date
    public var timeZone: TimeZone

    public init(sourceURL: URL,
                category: TransferCategory,
                direction: TransferDirection,
                shareRoot: URL,
                sourceHost: String,
                sourceUser: String,
                batchName: String? = nil,
                version: Int = 1,
                overwriteIfExists: Bool = false,
                now: Date = .init(),
                timeZone: TimeZone = .current) {
        self.sourceURL = sourceURL
        self.category = category
        self.direction = direction
        self.shareRoot = shareRoot
        self.sourceHost = sourceHost
        self.sourceUser = sourceUser
        self.batchName = batchName
        self.version = version
        self.overwriteIfExists = overwriteIfExists
        self.now = now
        self.timeZone = timeZone
    }
}

public struct TransferOutcome: Sendable {
    public var transferID: String
    public var destinationURL: URL          // 최종 셰어 경로
    public var sha256: String               // 파일 또는 dir-hash combined
    public var bytes: Int64
    public var mode: TransferMode
    public var manifestURL: URL
    public var sidecarURL: URL
    public var logURL: URL
}

// MARK: — Batch types (Phase 3 다중 drag-drop)

public struct BatchRequest: Sendable {
    public var items: [URL]                  // 파일/폴더 혼합 가능
    public var category: TransferCategory    // 한 batch = 한 카테고리 (기본: unsorted)
    public var direction: TransferDirection
    public var shareRoot: URL
    public var sourceHost: String
    public var sourceUser: String
    public var batchName: String?            // nil이면 timestamp 기반 자동
    public var version: Int
    public var overwriteIfExists: Bool
    public var now: Date
    public var timeZone: TimeZone

    public init(items: [URL],
                category: TransferCategory,
                direction: TransferDirection,
                shareRoot: URL,
                sourceHost: String,
                sourceUser: String,
                batchName: String? = nil,
                version: Int = 1,
                overwriteIfExists: Bool = false,
                now: Date = .init(),
                timeZone: TimeZone = .current) {
        self.items = items
        self.category = category
        self.direction = direction
        self.shareRoot = shareRoot
        self.sourceHost = sourceHost
        self.sourceUser = sourceUser
        self.batchName = batchName
        self.version = version
        self.overwriteIfExists = overwriteIfExists
        self.now = now
        self.timeZone = timeZone
    }
}

public struct ItemOutcome: Sendable {
    public var sourceURL: URL
    public var destinationURL: URL
    public var sha256: String          // 파일 SHA 또는 dir-hash
    public var bytes: Int64
    public var mode: TransferMode      // .file 또는 .directory (.batch 아님)
    public var category: TransferCategory
    public var finalName: String       // 적용된 네이밍
}

public struct BatchOutcome: Sendable {
    public var transferID: String
    public var items: [ItemOutcome]
    public var totalBytes: Int64
    public var manifestURL: URL
    public var sidecarURL: URL
    public var logURL: URL
}

public enum TransferEngine {

    public static func send(_ req: TransferRequest) throws -> TransferOutcome {
        let fm = FileManager.default

        // 0. 셰어 마운트 / 소스 존재 확인
        guard fm.fileExists(atPath: req.shareRoot.path) else {
            throw TransferError.shareNotMounted(expectedPath: req.shareRoot.path)
        }
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: req.sourceURL.path, isDirectory: &isDir) else {
            throw TransferError.ioError("source not found: \(req.sourceURL.path)", underlying: nil)
        }
        let isDirectory = isDir.boolValue
        let mode: TransferMode = isDirectory ? .directory : .file

        // 1. RAW_SECRET 검사
        let topName = req.sourceURL.lastPathComponent
            .precomposedStringWithCanonicalMapping
        if let m = RawSecret.check(filename: topName) {
            throw TransferError.rawSecretBlocked(
                filename: topName, rule: m.rule, pattern: m.pattern)
        }
        if isDirectory {
            // 폴더 내부 파일명들도 검사
            if let enumerator = fm.enumerator(
                at: req.sourceURL,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles])
            {
                for case let url as URL in enumerator {
                    let rv = try url.resourceValues(forKeys: [.isRegularFileKey])
                    guard rv.isRegularFile == true else { continue }
                    let name = url.lastPathComponent.precomposedStringWithCanonicalMapping
                    if let m = RawSecret.check(filename: name) {
                        throw TransferError.rawSecretBlocked(
                            filename: name, rule: m.rule, pattern: m.pattern)
                    }
                }
            }
        }

        // 2. 네이밍 → 최종 파일/폴더명
        let finalName = Naming.render(date: req.now, category: req.category,
                                      originalURL: req.sourceURL,
                                      isDirectory: isDirectory,
                                      version: req.version,
                                      timeZone: req.timeZone)

        // 3. 도착지 경로
        // <shareRoot>/<exchangeFolder>/20_Ready/<categoryFolder>/<finalName>
        let destDir = req.shareRoot
            .appendingPathComponent(req.direction.exchangeFolder)
            .appendingPathComponent("20_Ready")
            .appendingPathComponent(req.category.folderCode)
        let destURL = destDir.appendingPathComponent(finalName)

        // 4. 덮어쓰기 확인
        if fm.fileExists(atPath: destURL.path) {
            if !req.overwriteIfExists {
                throw TransferError.destinationExists(path: destURL.path)
            }
            // 덮어쓰기: 기존 제거
            try removeQuietly(at: destURL)
        }

        // 5. 도착 디렉터리 보장 + 복사 (원자성: 임시 이름 → rename)
        try ensureDirectory(at: destDir)
        let tmpURL = destDir.appendingPathComponent(".incoming__" + UUID().uuidString)
        do {
            try fm.copyItem(at: req.sourceURL, to: tmpURL)
            try fm.moveItem(at: tmpURL, to: destURL)
        } catch {
            try? fm.removeItem(at: tmpURL)
            throw TransferError.ioError("copy failed → \(destURL.path)", underlying: error)
        }

        // 6. SHA-256
        let (sha, totalBytes): (String, Int64)
        switch mode {
        case .file:
            let attrs = try fm.attributesOfItem(atPath: destURL.path)
            totalBytes = (attrs[.size] as? Int64) ?? 0
            sha = try Hashing.sha256(file: destURL)
        case .directory:
            let digest = try Hashing.dirHash(folder: destURL)
            sha = digest.combined
            totalBytes = digest.totalBytes
        case .batch:
            throw TransferError.usageError("batch mode not implemented in Phase 1")
        }

        // 7. transfer_id + 매니페스트 + sidecar + log 작성
        let batchName = req.batchName ?? defaultBatchName(from: req.sourceURL,
                                                          isDirectory: isDirectory)
        let transferID = Manifest.makeTransferID(
            date: req.now, direction: req.direction,
            categoryKey: req.category.key, batchName: batchName,
            version: req.version, timeZone: req.timeZone
        )

        let manifest = buildManifest(req: req, transferID: transferID, mode: mode,
                                     finalName: finalName, destURL: destURL,
                                     sha: sha, totalBytes: totalBytes)
        let manifestData = try manifest.encodedJSON()
        let manifestURL = req.shareRoot
            .appendingPathComponent("00_System/30_Manifests")
            .appendingPathComponent(req.direction.rawValue)
            .appendingPathComponent("\(transferID).json")
        try ensureDirectory(at: manifestURL.deletingLastPathComponent())
        try atomicWrite(data: manifestData, to: manifestURL)

        let sidecarText: String
        switch mode {
        case .file:
            sidecarText = Checksum.renderFile(sha256: sha, filename: finalName)
        case .directory:
            let digest = try Hashing.dirHash(folder: destURL)  // 재계산 (entries 필요)
            sidecarText = Checksum.renderDirectory(folderName: finalName, digest: digest)
        case .batch:
            throw TransferError.usageError("batch mode not implemented in Phase 1")
        }
        let sidecarURL = req.shareRoot
            .appendingPathComponent("00_System/50_Checksums")
            .appendingPathComponent(req.direction.rawValue)
            .appendingPathComponent("\(transferID).sha256")
        try ensureDirectory(at: sidecarURL.deletingLastPathComponent())
        try atomicWrite(data: sidecarText.data(using: .utf8)!, to: sidecarURL)

        let logText = TransferLog.render(
            transferID: transferID, mode: mode,
            sourceAbsPath: req.sourceURL.path,
            destAbsPath: destURL.path,
            hashHex: sha, payloadBytes: totalBytes,
            at: req.now, timeZone: req.timeZone
        )
        let logURL = req.shareRoot
            .appendingPathComponent("00_System/40_Logs")
            .appendingPathComponent(req.direction.rawValue)
            .appendingPathComponent("\(transferID).log")
        try ensureDirectory(at: logURL.deletingLastPathComponent())
        try atomicWrite(data: logText.data(using: .utf8)!, to: logURL)

        // 8. 로컬 송신 이력 (Sent 화면용 single source). 실패해도 송신 자체는 성공.
        let historyEntry = SentHistoryEntry(
            transfer_id: transferID,
            created_at: Timestamps.iso8601(req.now, timeZone: req.timeZone),
            direction: req.direction.rawValue,
            mode: mode.rawValue,
            category: req.category.key,
            primary_name: finalName,
            item_count: 1,
            bytes: totalBytes,
            sha256: sha,
            dest_share_path: "\(req.direction.exchangeFolder)/20_Ready/\(req.category.folderCode)/",
            source_path: req.sourceURL.path
        )
        try? SentHistory.append(historyEntry)

        return TransferOutcome(
            transferID: transferID, destinationURL: destURL,
            sha256: sha, bytes: totalBytes, mode: mode,
            manifestURL: manifestURL, sidecarURL: sidecarURL, logURL: logURL
        )
    }

    // MARK: — Batch send (Phase 3, 다중 drag-drop)

    /// 다중 항목 → 한 transfer_id로 묶음. 전부 같은 카테고리.
    /// 기본 카테고리 = `Categories.unsorted` (LLM 분류 도입 전 안착지).
    public static func sendBatch(_ req: BatchRequest) throws -> BatchOutcome {
        let fm = FileManager.default

        // 0. 셰어 / items 존재 확인
        guard fm.fileExists(atPath: req.shareRoot.path) else {
            throw TransferError.shareNotMounted(expectedPath: req.shareRoot.path)
        }
        if req.items.isEmpty {
            throw TransferError.usageError("batch: empty items")
        }
        for url in req.items {
            guard fm.fileExists(atPath: url.path) else {
                throw TransferError.ioError("source not found: \(url.path)", underlying: nil)
            }
        }

        // 1. RAW_SECRET 검사 (top + 각 디렉터리 내부)
        for url in req.items {
            try checkRawSecretRecursive(at: url)
        }

        // 2. transfer_id (batch 공유)
        let batchName = req.batchName ?? defaultBatchName(items: req.items, at: req.now,
                                                          timeZone: req.timeZone)
        let transferID = Manifest.makeTransferID(
            date: req.now, direction: req.direction,
            categoryKey: req.category.key, batchName: batchName,
            version: req.version, timeZone: req.timeZone
        )

        // 3. 각 항목 처리 (네이밍 + 복사 + 해시)
        let destDir = req.shareRoot
            .appendingPathComponent(req.direction.exchangeFolder)
            .appendingPathComponent("20_Ready")
            .appendingPathComponent(req.category.folderCode)
        try ensureDirectory(at: destDir)

        var processed: [ItemOutcome] = []
        var totalBytes: Int64 = 0
        var manifestFiles: [Manifest.FileEntry] = []
        var sidecarLines: [String] = []

        let mtime = Timestamps.iso8601(req.now, timeZone: req.timeZone)

        for (idx, src) in req.items.enumerated() {
            var sDir: ObjCBool = false
            _ = fm.fileExists(atPath: src.path, isDirectory: &sDir)
            let isDir = sDir.boolValue
            let mode: TransferMode = isDir ? .directory : .file

            // 같은 카테고리에 다중 항목이면 v01~vNN으로 자동 bump (충돌 회피)
            // 또는 호출자가 명시한 version 사용
            let finalName = Naming.render(date: req.now, category: req.category,
                                          originalURL: src, isDirectory: isDir,
                                          version: req.version, timeZone: req.timeZone)
            let destURL = destDir.appendingPathComponent(finalName)

            if fm.fileExists(atPath: destURL.path) {
                if !req.overwriteIfExists {
                    throw TransferError.destinationExists(path: destURL.path)
                }
                try removeQuietly(at: destURL)
            }

            // 원자적 복사
            let tmpURL = destDir.appendingPathComponent(
                ".incoming__\(idx)__" + UUID().uuidString)
            do {
                try fm.copyItem(at: src, to: tmpURL)
                try fm.moveItem(at: tmpURL, to: destURL)
            } catch {
                try? fm.removeItem(at: tmpURL)
                throw TransferError.ioError("copy failed → \(destURL.path)", underlying: error)
            }

            // 해시 + 사이드카 라인
            let (sha, sz): (String, Int64)
            switch mode {
            case .file:
                let attrs = try fm.attributesOfItem(atPath: destURL.path)
                sz = (attrs[.size] as? Int64) ?? 0
                sha = try Hashing.sha256(file: destURL)
                sidecarLines.append(Checksum.renderFile(sha256: sha, filename: finalName))
            case .directory:
                let digest = try Hashing.dirHash(folder: destURL)
                sha = digest.combined
                sz = digest.totalBytes
                sidecarLines.append(
                    Checksum.renderDirectory(folderName: finalName, digest: digest))
            case .batch:
                throw TransferError.usageError("batch within batch is not supported")
            }

            totalBytes += sz
            manifestFiles.append(.init(path: finalName, size_bytes: sz,
                                       sha256: sha, mtime: mtime))
            processed.append(ItemOutcome(
                sourceURL: src, destinationURL: destURL,
                sha256: sha, bytes: sz, mode: mode,
                category: req.category, finalName: finalName
            ))
        }

        // 4. Manifest (batch)
        let primaryName = processed.first?.finalName ?? ""
        let manifest = Manifest(
            schema_version: 1,
            tool: "send-to-windows.swift (phase-1 shim)",
            tool_version: "0.1.0",
            transfer_id: transferID,
            created_at: Timestamps.iso8601(req.now, timeZone: req.timeZone),
            direction: req.direction.rawValue,
            category: req.category.key,
            batch_name: batchName,
            version: req.version,
            source: .init(host: req.sourceHost, user: req.sourceUser,
                          path: req.items.map(\.path).joined(separator: " ; ")),
            destination: .init(
                share_path: "\(req.direction.exchangeFolder)/20_Ready/\(req.category.folderCode)/",
                primary_file: primaryName),
            mode: TransferMode.batch.rawValue,
            files: manifestFiles,
            totals: .init(files_included: processed.count, bytes_out: totalBytes),
            state: "ready"
        )
        let manifestURL = req.shareRoot
            .appendingPathComponent("00_System/30_Manifests")
            .appendingPathComponent(req.direction.rawValue)
            .appendingPathComponent("\(transferID).json")
        try ensureDirectory(at: manifestURL.deletingLastPathComponent())
        try atomicWrite(data: manifest.encodedJSON(), to: manifestURL)

        // 5. Sidecar (모든 항목 라인 + 종합 코멘트)
        var sidecar = sidecarLines.joined()
        sidecar += "# batch: \(processed.count) items, \(totalBytes) bytes total\n"
        let sidecarURL = req.shareRoot
            .appendingPathComponent("00_System/50_Checksums")
            .appendingPathComponent(req.direction.rawValue)
            .appendingPathComponent("\(transferID).sha256")
        try ensureDirectory(at: sidecarURL.deletingLastPathComponent())
        try atomicWrite(data: sidecar.data(using: .utf8)!, to: sidecarURL)

        // 6. Log
        let logText = TransferLog.render(
            transferID: transferID, mode: .batch,
            sourceAbsPath: req.items.map(\.path).joined(separator: " ; "),
            destAbsPath: destDir.path,
            hashHex: "batch(\(processed.count))",
            payloadBytes: totalBytes,
            at: req.now, timeZone: req.timeZone
        )
        let logURL = req.shareRoot
            .appendingPathComponent("00_System/40_Logs")
            .appendingPathComponent(req.direction.rawValue)
            .appendingPathComponent("\(transferID).log")
        try ensureDirectory(at: logURL.deletingLastPathComponent())
        try atomicWrite(data: logText.data(using: .utf8)!, to: logURL)

        // 7. SentHistory
        let firstName = primaryName
        let label = processed.count == 1
            ? firstName
            : "\(firstName) 외 \(processed.count - 1)개"
        try? SentHistory.append(SentHistoryEntry(
            transfer_id: transferID,
            created_at: Timestamps.iso8601(req.now, timeZone: req.timeZone),
            direction: req.direction.rawValue,
            mode: TransferMode.batch.rawValue,
            category: req.category.key,
            primary_name: label,
            item_count: processed.count,
            bytes: totalBytes,
            sha256: nil,
            dest_share_path: "\(req.direction.exchangeFolder)/20_Ready/\(req.category.folderCode)/",
            source_path: req.items.map(\.path).joined(separator: " ; ")
        ))

        return BatchOutcome(
            transferID: transferID,
            items: processed,
            totalBytes: totalBytes,
            manifestURL: manifestURL,
            sidecarURL: sidecarURL,
            logURL: logURL
        )
    }

    // MARK: — Helpers

    private static func buildManifest(req: TransferRequest,
                                      transferID: String,
                                      mode: TransferMode,
                                      finalName: String,
                                      destURL: URL,
                                      sha: String,
                                      totalBytes: Int64) -> Manifest {
        let sharePath = "\(req.direction.exchangeFolder)/20_Ready/\(req.category.folderCode)/"
        let mtime = Timestamps.iso8601(req.now, timeZone: req.timeZone)
        return Manifest(
            schema_version: 1,
            tool: "send-to-windows.swift (phase-1 shim)",
            tool_version: "0.1.0",
            transfer_id: transferID,
            created_at: Timestamps.iso8601(req.now, timeZone: req.timeZone),
            direction: req.direction.rawValue,
            category: req.category.key,
            batch_name: req.batchName ?? defaultBatchName(from: req.sourceURL,
                                                          isDirectory: mode == .directory),
            version: req.version,
            source: .init(host: req.sourceHost, user: req.sourceUser,
                          path: req.sourceURL.path),
            destination: .init(share_path: sharePath, primary_file: finalName),
            mode: mode.rawValue,
            files: [.init(path: finalName, size_bytes: totalBytes,
                          sha256: sha, mtime: mtime)],
            totals: .init(files_included: 1, bytes_out: totalBytes),
            state: "ready"
        )
    }

    private static func defaultBatchName(from url: URL, isDirectory: Bool) -> String {
        let (base, _) = Naming.split(originalURL: url, isDirectory: isDirectory)
        return base
    }

    private static func defaultBatchName(items: [URL], at date: Date,
                                         timeZone: TimeZone) -> String {
        // batch는 시간만 박아도 충돌 회피 충분.
        // 예: batch-20260519-101500
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyyMMdd-HHmmss"
        return "batch-\(f.string(from: date))"
    }

    private static func checkRawSecretRecursive(at url: URL) throws {
        let fm = FileManager.default
        let topName = url.lastPathComponent.precomposedStringWithCanonicalMapping
        if let m = RawSecret.check(filename: topName) {
            throw TransferError.rawSecretBlocked(
                filename: topName, rule: m.rule, pattern: m.pattern)
        }
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue
        else { return }
        if let en = fm.enumerator(at: url,
                                  includingPropertiesForKeys: [.isRegularFileKey],
                                  options: [.skipsHiddenFiles])
        {
            for case let u as URL in en {
                let rv = try u.resourceValues(forKeys: [.isRegularFileKey])
                guard rv.isRegularFile == true else { continue }
                let n = u.lastPathComponent.precomposedStringWithCanonicalMapping
                if let m = RawSecret.check(filename: n) {
                    throw TransferError.rawSecretBlocked(
                        filename: n, rule: m.rule, pattern: m.pattern)
                }
            }
        }
    }

    private static func ensureDirectory(at url: URL) throws {
        try FileManager.default.createDirectory(at: url,
                                                withIntermediateDirectories: true)
    }

    private static func atomicWrite(data: Data, to url: URL) throws {
        do {
            try data.write(to: url, options: [.atomic])
        } catch {
            throw TransferError.ioError("write: \(url.path)", underlying: error)
        }
    }

    private static func removeQuietly(at url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            throw TransferError.ioError("remove existing: \(url.path)", underlying: error)
        }
    }
}
