import XCTest
import CryptoKit
@testable import TransferCore

final class HashingTests: XCTestCase {

    private var tmpRoot: URL!

    override func setUp() {
        super.setUp()
        tmpRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hashing-tests-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: tmpRoot,
                                                 withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tmpRoot)
        tmpRoot = nil
        super.tearDown()
    }

    // MARK: — file SHA-256

    func test_sha256_emptyFile() throws {
        let f = tmpRoot.appendingPathComponent("empty.bin")
        FileManager.default.createFile(atPath: f.path, contents: Data())
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        XCTAssertEqual(try Hashing.sha256(file: f),
                       "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func test_sha256_helloWorld() throws {
        let f = tmpRoot.appendingPathComponent("hello.txt")
        try "Hello, World!".data(using: .utf8)!.write(to: f)
        // SHA-256("Hello, World!") = dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f
        XCTAssertEqual(try Hashing.sha256(file: f),
                       "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f")
    }

    func test_sha256_largeFile_streamingChunks() throws {
        let f = tmpRoot.appendingPathComponent("big.bin")
        // 3MB of zeros — exceeds 1MB chunk size to exercise streaming
        let data = Data(count: 3 * 1_048_576)
        try data.write(to: f)
        let actual = try Hashing.sha256(file: f)
        // Expected via CryptoKit one-shot
        let expected = SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(actual, expected)
    }

    func test_sha256_nonexistentFile_throws() {
        let f = tmpRoot.appendingPathComponent("nope.bin")
        XCTAssertThrowsError(try Hashing.sha256(file: f)) { err in
            guard case TransferError.ioError = err else {
                XCTFail("expected ioError, got \(err)"); return
            }
        }
    }

    // MARK: — dir-hash

    func test_dirHash_singleFile() throws {
        let dir = tmpRoot.appendingPathComponent("oneFile")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "abc".data(using: .utf8)!.write(to: dir.appendingPathComponent("a.txt"))

        let digest = try Hashing.dirHash(folder: dir)
        XCTAssertEqual(digest.entries.count, 1)
        XCTAssertEqual(digest.entries[0].relativePath, "a.txt")
        XCTAssertEqual(digest.entries[0].sha256,
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")  // SHA("abc")
        XCTAssertEqual(digest.entries[0].sizeBytes, 3)
        XCTAssertEqual(digest.totalBytes, 3)

        // combined = SHA-256("a.txt\0<sha>\n")
        var expectedInput = Data()
        expectedInput.append("a.txt".data(using: .utf8)!)
        expectedInput.append(0x00)
        expectedInput.append(digest.entries[0].sha256.data(using: .utf8)!)
        expectedInput.append(0x0A)
        let expectedCombined = SHA256.hash(data: expectedInput)
            .map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(digest.combined, expectedCombined)
    }

    func test_dirHash_lexicographicSort_overrides_filesystem_order() throws {
        let dir = tmpRoot.appendingPathComponent("sortCheck")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // 의도적으로 알파벳 역순으로 생성 — 정렬 후엔 a/b/c 순서여야
        for name in ["z.txt", "m.txt", "a.txt"] {
            try name.data(using: .utf8)!
                .write(to: dir.appendingPathComponent(name))
        }
        let digest = try Hashing.dirHash(folder: dir)
        XCTAssertEqual(digest.entries.map(\.relativePath), ["a.txt", "m.txt", "z.txt"])
    }

    func test_dirHash_nestedFolders_relativePath_forwardSlash() throws {
        let dir = tmpRoot.appendingPathComponent("nested")
        try FileManager.default.createDirectory(
            at: dir.appendingPathComponent("sub/deep"),
            withIntermediateDirectories: true)
        try "x".data(using: .utf8)!
            .write(to: dir.appendingPathComponent("sub/deep/leaf.txt"))
        try "y".data(using: .utf8)!
            .write(to: dir.appendingPathComponent("top.txt"))

        let digest = try Hashing.dirHash(folder: dir)
        let rels = digest.entries.map(\.relativePath).sorted()
        XCTAssertEqual(rels, ["sub/deep/leaf.txt", "top.txt"])
        // forward slash 확인
        for ent in digest.entries {
            XCTAssertFalse(ent.relativePath.contains("\\"),
                           "backslash 발견: \(ent.relativePath)")
        }
    }

    func test_dirHash_koreanFilenames_NFC() throws {
        let dir = tmpRoot.appendingPathComponent("korean")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let names = ["예상 공수 산정 근거.html", "추가 개발 상세 기획서.html"]
        for n in names {
            try "data".data(using: .utf8)!
                .write(to: dir.appendingPathComponent(n))
        }
        let digest = try Hashing.dirHash(folder: dir)
        XCTAssertEqual(digest.entries.count, 2)
        // 각 relativePath는 NFC여야 (HFS+/SMB NFD 회피)
        for ent in digest.entries {
            XCTAssertEqual(ent.relativePath,
                           ent.relativePath.precomposedStringWithCanonicalMapping)
        }
    }

    func test_dirHash_emptyFolder() throws {
        let dir = tmpRoot.appendingPathComponent("empty")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let digest = try Hashing.dirHash(folder: dir)
        XCTAssertEqual(digest.entries.count, 0)
        XCTAssertEqual(digest.totalBytes, 0)
        // empty input → SHA-256("") = e3b0c4...b855
        XCTAssertEqual(digest.combined,
                       "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func test_dirHash_deterministic_acrossRuns() throws {
        // 같은 입력 → 같은 hash (정렬·정규화가 결정적임을 확인)
        let dir = tmpRoot.appendingPathComponent("det")
        try FileManager.default.createDirectory(
            at: dir.appendingPathComponent("nested"),
            withIntermediateDirectories: true)
        try "hello".write(to: dir.appendingPathComponent("a.txt"),
                          atomically: true, encoding: .utf8)
        try "world".write(to: dir.appendingPathComponent("nested/b.txt"),
                          atomically: true, encoding: .utf8)

        let d1 = try Hashing.dirHash(folder: dir)
        let d2 = try Hashing.dirHash(folder: dir)
        XCTAssertEqual(d1.combined, d2.combined)
        XCTAssertEqual(d1.entries, d2.entries)
    }
}
