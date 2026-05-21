import XCTest
@testable import TransferCore

final class ChecksumTests: XCTestCase {

    func test_renderFile_basic() {
        let line = Checksum.renderFile(
            sha256: "f241b64ecb58c8ee34c43d83720deb5775db9c54f27a17fd58cd4069edc04c34",
            filename: "2026-05-17__documents__report__v01.html"
        )
        XCTAssertEqual(line,
                       "f241b64ecb58c8ee34c43d83720deb5775db9c54f27a17fd58cd4069edc04c34" +
                       "  " +  // 두 칸 공백
                       "2026-05-17__documents__report__v01.html\n")
    }

    func test_renderFile_korean_NFC() {
        // 입력이 NFD라도 출력 byte sequence는 NFC여야 한다.
        // Swift String.contains는 canonical-equivalence라서 같은 글자로 보지만,
        // 우리는 디스크/sidecar에 NFC 바이트가 정확히 들어가야 (HFS+/SMB 호환).
        let nfd = "예상".decomposedStringWithCanonicalMapping
        let line = Checksum.renderFile(sha256: "deadbeef", filename: nfd + ".html")

        let lineBytes = line.data(using: .utf8)!
        let nfcBytes = "예상.html".data(using: .utf8)!
        let nfdBytes = (nfd + ".html").data(using: .utf8)!

        XCTAssertTrue(lineBytes.range(of: nfcBytes) != nil,
                      "output should contain NFC bytes")
        XCTAssertNil(lineBytes.range(of: nfdBytes),
                     "output must NOT contain NFD bytes")
    }

    func test_renderFile_endsWithLF_notCRLF() {
        let line = Checksum.renderFile(sha256: "abc", filename: "x.txt")
        XCTAssertTrue(line.hasSuffix("\n"))
        XCTAssertFalse(line.hasSuffix("\r\n"))
    }

    func test_renderFile_exactByteFormat() {
        let line = Checksum.renderFile(sha256: "abc123", filename: "x.txt")
        XCTAssertEqual(line.data(using: .utf8)!, Data("abc123  x.txt\n".utf8))
    }

    func test_renderDirectory_multiFile_plusCombinedComment() {
        let entries: [Hashing.FileEntry] = [
            .init(relativePath: "a.txt",   sha256: "aaa", sizeBytes: 3),
            .init(relativePath: "sub/b.txt", sha256: "bbb", sizeBytes: 5),
        ]
        let digest = Hashing.DirectoryDigest(combined: "ccc",
                                             entries: entries,
                                             totalBytes: 8)
        let out = Checksum.renderDirectory(folderName: "my-project", digest: digest)
        let expected =
            "aaa  my-project/a.txt\n" +
            "bbb  my-project/sub/b.txt\n" +
            "ccc  my-project  # combined dir-hash\n"
        XCTAssertEqual(out, expected)
    }

    func test_renderDirectory_emptyFolder_onlyCombinedLine() {
        let digest = Hashing.DirectoryDigest(combined: "e3b0c4...",
                                             entries: [],
                                             totalBytes: 0)
        let out = Checksum.renderDirectory(folderName: "empty", digest: digest)
        XCTAssertEqual(out, "e3b0c4...  empty  # combined dir-hash\n")
    }
}
