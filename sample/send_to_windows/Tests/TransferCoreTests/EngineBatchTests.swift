import XCTest
@testable import TransferCore

final class EngineBatchTests: XCTestCase {

    private var tmpRoot: URL!
    private var sourceDir: URL!
    private var shareRoot: URL!
    private var savedHistoryPath: URL!
    private let kst = TimeZone(identifier: "Asia/Seoul")!

    override func setUp() {
        super.setUp()
        tmpRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("engine-batch-\(UUID().uuidString)")
        sourceDir = tmpRoot.appendingPathComponent("src")
        shareRoot = tmpRoot.appendingPathComponent("share")
        try! FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try! FileManager.default.createDirectory(at: shareRoot, withIntermediateDirectories: true)
        // SentHistory 테스트 격리
        savedHistoryPath = SentHistory.path
        SentHistory.path = tmpRoot.appendingPathComponent("sent.jsonl")
    }

    override func tearDown() {
        SentHistory.path = savedHistoryPath
        try? FileManager.default.removeItem(at: tmpRoot)
        super.tearDown()
    }

    private func fixedDate() -> Date {
        ISO8601DateFormatter().date(from: "2026-05-19T10:15:00+09:00")!
    }

    private func batchReq(items: [URL],
                          category: TransferCategory = Categories.unsorted,
                          overwrite: Bool = false) -> BatchRequest {
        BatchRequest(
            items: items, category: category, direction: .macToWindows,
            shareRoot: shareRoot, sourceHost: "TEST", sourceUser: "tester",
            batchName: nil, version: 1, overwriteIfExists: overwrite,
            now: fixedDate(), timeZone: kst
        )
    }

    func test_batch_threeFiles_allLandInUnsorted() throws {
        let urls = try (1...3).map { i -> URL in
            let u = sourceDir.appendingPathComponent("file-\(i).txt")
            try "content \(i)".write(to: u, atomically: true, encoding: .utf8)
            return u
        }
        let outcome = try TransferEngine.sendBatch(batchReq(items: urls))
        XCTAssertEqual(outcome.items.count, 3)
        XCTAssertTrue(outcome.transferID.contains("__unsorted__batch-"))

        for item in outcome.items {
            XCTAssertTrue(item.destinationURL.path.contains("/99_Unsorted/"))
            XCTAssertTrue(FileManager.default.fileExists(atPath: item.destinationURL.path))
            XCTAssertTrue(item.finalName.contains("__unsorted__"))
        }

        // Manifest = 3 files
        let m = try Manifest.decode(from: Data(contentsOf: outcome.manifestURL))
        XCTAssertEqual(m.mode, "batch")
        XCTAssertEqual(m.files.count, 3)
        XCTAssertEqual(m.totals.files_included, 3)
        XCTAssertEqual(m.category, "unsorted")
    }

    func test_batch_mixedFileAndDirectory() throws {
        let file = sourceDir.appendingPathComponent("doc.html")
        try "<x/>".write(to: file, atomically: true, encoding: .utf8)
        let folder = sourceDir.appendingPathComponent("myproj")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try "a".write(to: folder.appendingPathComponent("a.txt"),
                      atomically: true, encoding: .utf8)

        let outcome = try TransferEngine.sendBatch(batchReq(items: [file, folder]))
        XCTAssertEqual(outcome.items.count, 2)
        // 첫 항목은 .file, 두 번째는 .directory
        let modes = outcome.items.map(\.mode)
        XCTAssertTrue(modes.contains(.file))
        XCTAssertTrue(modes.contains(.directory))

        // Sidecar 라인 — 파일 1줄 + 폴더면 (내부 1줄 + combined 1줄)
        let sidecar = try String(contentsOf: outcome.sidecarURL, encoding: .utf8)
        XCTAssertTrue(sidecar.contains("# batch:"))
        XCTAssertTrue(sidecar.contains("combined dir-hash"))
    }

    func test_batch_singleItem_stillBatchMode_butValid() throws {
        let url = sourceDir.appendingPathComponent("single.txt")
        try "x".write(to: url, atomically: true, encoding: .utf8)
        let outcome = try TransferEngine.sendBatch(batchReq(items: [url]))
        XCTAssertEqual(outcome.items.count, 1)
        let m = try Manifest.decode(from: Data(contentsOf: outcome.manifestURL))
        XCTAssertEqual(m.mode, "batch")
        XCTAssertEqual(m.totals.files_included, 1)
    }

    func test_batch_empty_throws() {
        XCTAssertThrowsError(try TransferEngine.sendBatch(batchReq(items: []))) { err in
            guard case TransferError.usageError = err else {
                XCTFail("expected usageError, got \(err)"); return
            }
        }
    }

    func test_batch_RAW_SECRET_blocks_entireBatch() throws {
        let good = sourceDir.appendingPathComponent("good.txt")
        try "ok".write(to: good, atomically: true, encoding: .utf8)
        let bad = sourceDir.appendingPathComponent("private.pem")
        try "secret".write(to: bad, atomically: true, encoding: .utf8)

        XCTAssertThrowsError(try TransferEngine.sendBatch(batchReq(items: [good, bad]))) { err in
            guard case TransferError.rawSecretBlocked(_, _, let pat) = err else {
                XCTFail("expected rawSecretBlocked, got \(err)"); return
            }
            XCTAssertEqual(pat, "*.pem")
        }
        // 부분 잔재 없는지 — 도착지에 파일 0개여야
        let dst = shareRoot.appendingPathComponent(
            "10_Exchange/10_Mac_to_Windows/20_Ready/99_Unsorted")
        if FileManager.default.fileExists(atPath: dst.path) {
            let c = try FileManager.default.contentsOfDirectory(atPath: dst.path)
            XCTAssertEqual(c.count, 0)
        }
    }

    func test_batch_appendsSentHistory() throws {
        let urls = (1...2).map { i -> URL in
            let u = sourceDir.appendingPathComponent("h-\(i).txt")
            try? "x".write(to: u, atomically: true, encoding: .utf8)
            return u
        }
        _ = try TransferEngine.sendBatch(batchReq(items: urls))
        let history = try SentHistory.readAll()
        XCTAssertEqual(history.count, 1)
        XCTAssertEqual(history[0].mode, "batch")
        XCTAssertEqual(history[0].item_count, 2)
        XCTAssertEqual(history[0].category, "unsorted")
        XCTAssertTrue(history[0].primary_name.contains("외 1개"))
    }

    func test_singleSend_alsoAppendsSentHistory() throws {
        let url = sourceDir.appendingPathComponent("doc.txt")
        try "x".write(to: url, atomically: true, encoding: .utf8)
        let req = TransferRequest(
            sourceURL: url, category: Categories.default, direction: .macToWindows,
            shareRoot: shareRoot, sourceHost: "T", sourceUser: "u",
            now: fixedDate(), timeZone: kst
        )
        _ = try TransferEngine.send(req)
        let history = try SentHistory.readAll()
        XCTAssertEqual(history.count, 1)
        XCTAssertEqual(history[0].mode, "file")
        XCTAssertEqual(history[0].item_count, 1)
        XCTAssertEqual(history[0].category, "documents")
    }
}
