// Manifest.swift — §4.5 manifest JSON 스키마.
//
// Phase-1 shim 기준. shareguard 정식 구현 시 SHAREGUARD_SPEC.md §5 v1 풀스키마로 진화.
//
// transfer_id 형식:
//   <YYYY-MM-DDTHHmmss±ZZZZ>__<source>__<target>__<category>__<batch-name>__v<NN>
//
// 출력은 항상 `.sortedKeys`로 deterministic — diff/검증 안정성.

import Foundation

public struct Manifest: Sendable, Codable, Equatable {
    public var schema_version: Int
    public var tool: String
    public var tool_version: String

    public var transfer_id: String
    public var created_at: String        // ISO 8601 (with colons)

    public var direction: String         // "mac_to_windows" / "windows_to_mac"
    public var category: String          // key
    public var batch_name: String
    public var version: Int

    public var source: Source
    public var destination: Destination
    public var mode: String              // "file" / "directory" / "batch"
    public var files: [FileEntry]
    public var totals: Totals
    public var state: String             // "ready" / "received" / "archived" / "rejected"

    public struct Source: Sendable, Codable, Equatable {
        public var host: String
        public var user: String
        public var path: String
    }

    public struct Destination: Sendable, Codable, Equatable {
        public var share_path: String    // "10_Exchange/10_Mac_to_Windows/20_Ready/30_Documents/"
        public var primary_file: String  // 첫 파일명 (renamed)
    }

    public struct FileEntry: Sendable, Codable, Equatable {
        public var path: String          // primary_file 기준 상대 (단일 파일이면 동일)
        public var size_bytes: Int64
        public var sha256: String        // lowercase hex
        public var mtime: String         // ISO 8601
    }

    public struct Totals: Sendable, Codable, Equatable {
        public var files_included: Int
        public var bytes_out: Int64
    }

    // MARK: — IDs

    /// transfer_id 생성.
    public static func makeTransferID(date: Date,
                                      direction: TransferDirection,
                                      categoryKey: String,
                                      batchName: String,
                                      version: Int,
                                      timeZone: TimeZone = .current) -> String {
        let ts = Timestamps.transferIDTimestamp(date, timeZone: timeZone)
        let v  = String(format: "v%02d", version)
        return "\(ts)__\(direction.source)__\(direction.target)__\(categoryKey)__\(batchName)__\(v)"
    }

    // MARK: — Encoding

    public func encodedJSON(pretty: Bool = true) throws -> Data {
        let enc = JSONEncoder()
        var opts: JSONEncoder.OutputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        if pretty { opts.insert(.prettyPrinted) }
        enc.outputFormatting = opts
        return try enc.encode(self)
    }

    public static func decode(from data: Data) throws -> Manifest {
        try JSONDecoder().decode(Manifest.self, from: data)
    }
}
