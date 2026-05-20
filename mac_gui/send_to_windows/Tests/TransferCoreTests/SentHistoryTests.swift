import XCTest
@testable import TransferCore

final class SentHistoryTests: XCTestCase {

    private var tmpDir: URL!
    private var savedPath: URL!

    override func setUp() {
        super.setUp()
        tmpDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("history-tests-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        // 테스트 격리: 진짜 ~/Library 건드리지 않고 임시 경로 사용
        savedPath = SentHistory.path
        SentHistory.path = tmpDir.appendingPathComponent("sent.jsonl")
    }

    override func tearDown() {
        SentHistory.path = savedPath
        try? FileManager.default.removeItem(at: tmpDir)
        super.tearDown()
    }

    func test_readAll_emptyWhenFileMissing() throws {
        XCTAssertEqual(try SentHistory.readAll().count, 0)
    }

    func test_append_thenRead() throws {
        let e1 = sample(id: "T1", primary: "report.html")
        let e2 = sample(id: "T2", primary: "myproj")
        try SentHistory.append(e1)
        try SentHistory.append(e2)
        let all = try SentHistory.readAll()
        XCTAssertEqual(all.count, 2)
        XCTAssertEqual(all[0], e1)
        XCTAssertEqual(all[1], e2)
    }

    func test_append_isAppendOnly_doesNotRewriteHistory() throws {
        for i in 1...5 {
            try SentHistory.append(sample(id: "T\(i)", primary: "f\(i)"))
        }
        let all = try SentHistory.readAll()
        XCTAssertEqual(all.map(\.transfer_id), (1...5).map { "T\($0)" })
    }

    func test_brokenLine_skippedGracefully() throws {
        try SentHistory.append(sample(id: "T1", primary: "f1"))
        // 깨진 라인 1줄 강제 삽입
        let handle = try FileHandle(forWritingTo: SentHistory.path)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("{not valid json}\n".utf8))
        try handle.close()
        try SentHistory.append(sample(id: "T2", primary: "f2"))
        let all = try SentHistory.readAll()
        XCTAssertEqual(all.count, 2, "깨진 라인은 skip")
        XCTAssertEqual(all.map(\.transfer_id), ["T1", "T2"])
    }

    func test_jsonl_lineFormat() throws {
        try SentHistory.append(sample(id: "T1", primary: "x"))
        let raw = try String(contentsOf: SentHistory.path, encoding: .utf8)
        XCTAssertTrue(raw.hasSuffix("\n"))
        XCTAssertFalse(raw.hasSuffix("\r\n"))
        // 한 entry → 한 라인 (no pretty-printed newlines)
        let lines = raw.split(separator: "\n")
        XCTAssertEqual(lines.count, 1)
    }

    // MARK: helper

    private func sample(id: String, primary: String) -> SentHistoryEntry {
        SentHistoryEntry(
            transfer_id: id,
            created_at: "2026-05-19T10:00:00+09:00",
            direction: "mac_to_windows",
            mode: "file",
            category: "documents",
            primary_name: primary,
            item_count: 1,
            bytes: 1024,
            sha256: "abc",
            dest_share_path: "10_Exchange/10_Mac_to_Windows/20_Ready/30_Documents/",
            source_path: "/Users/chan/Desktop/\(primary)"
        )
    }
}
