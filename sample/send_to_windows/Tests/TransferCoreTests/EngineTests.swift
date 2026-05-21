import XCTest
@testable import TransferCore

final class EngineTests: XCTestCase {

    private var tmpRoot: URL!
    private var sourceDir: URL!
    private var shareRoot: URL!
    private let kst = TimeZone(identifier: "Asia/Seoul")!

    override func setUp() {
        super.setUp()
        tmpRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("engine-tests-\(UUID().uuidString)")
        sourceDir = tmpRoot.appendingPathComponent("src")
        shareRoot = tmpRoot.appendingPathComponent("share")
        try! FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try! FileManager.default.createDirectory(at: shareRoot, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tmpRoot)
        super.tearDown()
    }

    private func fixedDate() -> Date {
        ISO8601DateFormatter().date(from: "2026-05-17T21:20:55+09:00")!
    }

    private func req(source: URL,
                     category: TransferCategory = Categories.byKey("documents")!,
                     direction: TransferDirection = .macToWindows,
                     overwrite: Bool = false,
                     batchName: String? = nil) -> TransferRequest {
        TransferRequest(
            sourceURL: source, category: category, direction: direction,
            shareRoot: shareRoot, sourceHost: "TEST-MAC", sourceUser: "tester",
            batchName: batchName, version: 1,
            overwriteIfExists: overwrite,
            now: fixedDate(), timeZone: kst
        )
    }

    // MARK: — file mode

    func test_send_file_basic() throws {
        let src = sourceDir.appendingPathComponent("report.html")
        try "<html>hi</html>".data(using: .utf8)!.write(to: src)

        let outcome = try TransferEngine.send(req(source: src))
        XCTAssertEqual(outcome.mode, .file)
        XCTAssertEqual(outcome.destinationURL.lastPathComponent,
                       "2026-05-17__documents__report__v01.html")
        XCTAssertTrue(outcome.destinationURL.path.contains(
            "10_Exchange/10_Mac_to_Windows/20_Ready/30_Documents/"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outcome.destinationURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outcome.manifestURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outcome.sidecarURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outcome.logURL.path))

        // Manifest 디코드 + 핵심 필드 검증
        let mData = try Data(contentsOf: outcome.manifestURL)
        let m = try Manifest.decode(from: mData)
        XCTAssertEqual(m.direction, "mac_to_windows")
        XCTAssertEqual(m.mode, "file")
        XCTAssertEqual(m.totals.bytes_out, outcome.bytes)
        XCTAssertEqual(m.files[0].sha256, outcome.sha256)
        XCTAssertEqual(m.state, "ready")
    }

    func test_send_file_koreanFilename() throws {
        let src = sourceDir.appendingPathComponent("예상 공수 산정 근거.html")
        try "data".data(using: .utf8)!.write(to: src)

        let outcome = try TransferEngine.send(req(source: src))
        XCTAssertEqual(outcome.destinationURL.lastPathComponent,
                       "2026-05-17__documents__예상 공수 산정 근거__v01.html")
    }

    func test_send_file_RAW_SECRET_blocked() throws {
        let src = sourceDir.appendingPathComponent("private.pem")
        try "fake".data(using: .utf8)!.write(to: src)

        XCTAssertThrowsError(try TransferEngine.send(req(source: src))) { err in
            guard case TransferError.rawSecretBlocked(_, _, let pat) = err else {
                XCTFail("expected rawSecretBlocked"); return
            }
            XCTAssertEqual(pat, "*.pem")
        }
        // 도착지에 파일이 안 생겼는지 확인 (블록 시 부분 잔재 X)
        let dest = shareRoot.appendingPathComponent(
            "10_Exchange/10_Mac_to_Windows/20_Ready/30_Documents")
        if FileManager.default.fileExists(atPath: dest.path) {
            let contents = try FileManager.default.contentsOfDirectory(atPath: dest.path)
            XCTAssertEqual(contents.count, 0)
        }
    }

    func test_send_file_destinationExists_throwsSignal() throws {
        let src = sourceDir.appendingPathComponent("report.html")
        try "v1".data(using: .utf8)!.write(to: src)
        _ = try TransferEngine.send(req(source: src))  // 1st OK

        XCTAssertThrowsError(try TransferEngine.send(req(source: src))) { err in
            guard case TransferError.destinationExists = err else {
                XCTFail("expected destinationExists, got \(err)"); return
            }
        }
    }

    func test_send_file_overwriteAllowed_replaces() throws {
        let src = sourceDir.appendingPathComponent("report.html")
        try "v1".data(using: .utf8)!.write(to: src)
        let first = try TransferEngine.send(req(source: src))

        // 내용 바꾼 후 덮어쓰기
        try "v2-different".data(using: .utf8)!.write(to: src)
        let second = try TransferEngine.send(req(source: src, overwrite: true))

        XCTAssertEqual(first.destinationURL, second.destinationURL)
        XCTAssertNotEqual(first.sha256, second.sha256, "내용 바뀌면 hash도 달라야")
        let actual = try String(contentsOf: second.destinationURL, encoding: .utf8)
        XCTAssertEqual(actual, "v2-different")
    }

    // MARK: — directory mode

    func test_send_directory_basic() throws {
        let src = sourceDir.appendingPathComponent("myproj")
        try FileManager.default.createDirectory(at: src.appendingPathComponent("sub"),
                                                withIntermediateDirectories: true)
        try "a".write(to: src.appendingPathComponent("a.txt"),
                      atomically: true, encoding: .utf8)
        try "b".write(to: src.appendingPathComponent("sub/b.txt"),
                      atomically: true, encoding: .utf8)

        let outcome = try TransferEngine.send(req(
            source: src, category: Categories.byKey("repos")!))
        XCTAssertEqual(outcome.mode, .directory)
        XCTAssertEqual(outcome.destinationURL.lastPathComponent,
                       "2026-05-17__repos__myproj__v01")
        XCTAssertTrue(outcome.destinationURL.path.contains(
            "10_Exchange/10_Mac_to_Windows/20_Ready/10_Repos/"))
        XCTAssertEqual(outcome.bytes, 2)  // "a" + "b"

        // 폴더 안 파일들도 들어왔는지
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: outcome.destinationURL.appendingPathComponent("a.txt").path))
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: outcome.destinationURL.appendingPathComponent("sub/b.txt").path))

        // sidecar 폴더 모드: 라인 + combined.
        // §4.6: "<sha>  <folder>/<rel>" 형식. <folder>는 renamed (도착 후 이름).
        let sidecar = try String(contentsOf: outcome.sidecarURL, encoding: .utf8)
        let folderName = "2026-05-17__repos__myproj__v01"
        XCTAssertTrue(sidecar.contains("\(folderName)/a.txt"),
                      "sidecar missing \(folderName)/a.txt:\n\(sidecar)")
        XCTAssertTrue(sidecar.contains("\(folderName)/sub/b.txt"))
        XCTAssertTrue(sidecar.contains("# combined dir-hash"))
    }

    func test_send_directory_blocksIfInteriorRAW_SECRET() throws {
        let src = sourceDir.appendingPathComponent("badproj")
        try FileManager.default.createDirectory(at: src, withIntermediateDirectories: true)
        try "ok".write(to: src.appendingPathComponent("readme.md"),
                       atomically: true, encoding: .utf8)
        try "secret".write(to: src.appendingPathComponent("identity.pem"),
                           atomically: true, encoding: .utf8)

        XCTAssertThrowsError(try TransferEngine.send(
            req(source: src, category: Categories.byKey("repos")!))) { err in
            guard case TransferError.rawSecretBlocked(_, _, let pat) = err else {
                XCTFail("expected rawSecretBlocked"); return
            }
            XCTAssertEqual(pat, "*.pem")
        }
    }

    // MARK: — share/source validation

    func test_send_shareNotMounted_throws() {
        let src = sourceDir.appendingPathComponent("x.txt")
        try? "hi".write(to: src, atomically: true, encoding: .utf8)

        var r = req(source: src)
        r.shareRoot = URL(fileURLWithPath: "/nonexistent/share/path/\(UUID())")
        XCTAssertThrowsError(try TransferEngine.send(r)) { err in
            guard case TransferError.shareNotMounted = err else {
                XCTFail("expected shareNotMounted"); return
            }
        }
    }

    func test_send_sourceNotFound_throws() {
        let src = sourceDir.appendingPathComponent("ghost.txt")  // 안 만듦
        XCTAssertThrowsError(try TransferEngine.send(req(source: src))) { err in
            guard case TransferError.ioError = err else {
                XCTFail("expected ioError, got \(err)"); return
            }
        }
    }

    // MARK: — direction reverse

    func test_send_windowsToMacDirection_writesUnderCorrectFolder() throws {
        let src = sourceDir.appendingPathComponent("report.html")
        try "x".write(to: src, atomically: true, encoding: .utf8)
        let outcome = try TransferEngine.send(req(source: src, direction: .windowsToMac))
        XCTAssertTrue(outcome.destinationURL.path.contains(
            "10_Exchange/20_Windows_to_Mac/20_Ready/30_Documents/"))
        XCTAssertTrue(outcome.manifestURL.path.contains("30_Manifests/windows_to_mac/"))
        XCTAssertTrue(outcome.sidecarURL.path.contains("50_Checksums/windows_to_mac/"))
        XCTAssertTrue(outcome.logURL.path.contains("40_Logs/windows_to_mac/"))
        // transfer_id는 windows→mac 방향이면 source=windows, target=mac
        XCTAssertTrue(outcome.transferID.contains("__windows__mac__"))
    }
}
