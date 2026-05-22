// SentHistory.swift — 로컬 송신 이력 (append-only JSONL).
//
// 결정 #10: "보낸 파일" 화면의 source는 로컬 jsonl 로그 (셰어 의존 X).
// 셰어 파일이 나중에 지워져도 로그 엔트리는 그대로 유지 → 송신 기록은 영구.
//
// 경로: ~/Library/Logs/MacWindowShare/sent.jsonl
// 포맷: 한 줄당 한 transfer 기록 (JSON Lines)

import Foundation

public struct SentHistoryEntry: Sendable, Codable, Equatable, Identifiable {
    public var transfer_id: String
    public var created_at: String         // ISO 8601
    public var direction: String          // mac_to_windows (현재만)
    public var mode: String               // file / directory / batch
    public var category: String           // key (batch면 다수면 "mixed" 또는 첫 카테고리)
    public var primary_name: String       // 표시용 — 단일이면 그 이름, batch면 "N개 항목"
    public var item_count: Int
    public var bytes: Int64
    public var sha256: String?            // single/directory만; batch는 nil
    public var dest_share_path: String    // <exchange>/20_Ready/<folder>/
    public var source_path: String        // 원본 (절대경로, 표시용)

    public var id: String { transfer_id }
}

public enum SentHistory {

    public static var path: URL = {
        URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Logs/MacWindowShare/sent.jsonl")
    }()

    /// 로그 1줄 append.
    public static func append(_ entry: SentHistoryEntry) throws {
        try ensureParentDir()
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try enc.encode(entry)
        data.append(0x0A)  // \n
        let url = path
        let fm = FileManager.default
        if fm.fileExists(atPath: url.path) {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } else {
            try data.write(to: url, options: [.atomic])
        }
    }

    /// 모든 엔트리 읽기 (가장 최근이 마지막). 파일 없으면 빈 배열.
    public static func readAll() throws -> [SentHistoryEntry] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: path.path) else { return [] }
        let data = try Data(contentsOf: path)
        let dec = JSONDecoder()
        var out: [SentHistoryEntry] = []
        for line in data.split(separator: 0x0A) where !line.isEmpty {
            guard let entry = try? dec.decode(SentHistoryEntry.self, from: line) else {
                continue  // 깨진 라인은 skip (forward-compatibility)
            }
            out.append(entry)
        }
        return out
    }

    // MARK: — Internal

    private static func ensureParentDir() throws {
        let parent = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: parent, withIntermediateDirectories: true)
    }
}
