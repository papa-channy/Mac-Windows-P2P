import XCTest
@testable import TransferCore

final class LogTests: XCTestCase {

    private static let kst = TimeZone(identifier: "Asia/Seoul")!

    func test_render_threeLines_structure() {
        let date = ISO8601DateFormatter().date(from: "2026-05-17T21:20:55+09:00")!
        let s = TransferLog.render(
            transferID: "2026-05-17T212055+0900__mac__windows__documents__report__v01",
            mode: .file,
            sourceAbsPath: "/Users/chan/Desktop/report.html",
            destAbsPath: "/Volumes/Mac-Window_Share/10_Exchange/.../report.html",
            hashHex: "f241b64e",
            payloadBytes: 18185,
            at: date, timeZone: Self.kst
        )
        let lines = s.split(separator: "\n", omittingEmptySubsequences: false)
        XCTAssertEqual(lines.count, 4)  // 3 content lines + trailing empty (because of \n at end)
        XCTAssertTrue(lines[0].contains("context-menu send:"))
        XCTAssertTrue(lines[0].contains("/Users/chan/Desktop/report.html"))
        XCTAssertTrue(lines[0].contains(" -> "))
        XCTAssertTrue(lines[1].contains("mode=file"))
        XCTAssertTrue(lines[1].contains("hash=f241b64e"))
        XCTAssertTrue(lines[1].contains("payload=18185 bytes"))
        XCTAssertTrue(lines[2].contains("state=ready"))
        XCTAssertTrue(lines[2].contains("transfer_id=2026-05-17T212055+0900__"))
    }

    func test_render_directoryMode() {
        let date = ISO8601DateFormatter().date(from: "2026-05-17T21:20:55+09:00")!
        let s = TransferLog.render(
            transferID: "2026-05-17T212055+0900__mac__windows__repos__myproj__v01",
            mode: .directory,
            sourceAbsPath: "/Users/chan/Developer/myproj",
            destAbsPath: "/Volumes/Mac-Window_Share/10_Exchange/.../myproj",
            hashHex: "abc",
            payloadBytes: 123456,
            at: date, timeZone: Self.kst
        )
        XCTAssertTrue(s.contains("mode=directory"))
    }

    func test_render_timestampWithMicroseconds() {
        let date = ISO8601DateFormatter().date(from: "2026-05-17T21:20:55+09:00")!
        let s = TransferLog.render(
            transferID: "tid", mode: .file,
            sourceAbsPath: "/s", destAbsPath: "/d",
            hashHex: "x", payloadBytes: 0,
            at: date, timeZone: Self.kst
        )
        // [2026-05-17T21:20:55.000000+09:00] pattern (마이크로초 7자리 패딩)
        XCTAssertTrue(s.contains("[2026-05-17T21:20:55."))
        XCTAssertTrue(s.contains("+09:00]"))
    }

    func test_render_allLinesShareTimestamp() {
        // 한 번의 render() 호출 안에서 3줄이 같은 ts를 가져야 (호출 시점 = 1회 측정)
        let s = TransferLog.render(
            transferID: "tid", mode: .file,
            sourceAbsPath: "/s", destAbsPath: "/d",
            hashHex: "x", payloadBytes: 0
        )
        let lines = s.split(separator: "\n", omittingEmptySubsequences: true)
        XCTAssertEqual(lines.count, 3)
        let ts0 = String(lines[0].prefix(while: { $0 != "]" })) + "]"
        let ts1 = String(lines[1].prefix(while: { $0 != "]" })) + "]"
        let ts2 = String(lines[2].prefix(while: { $0 != "]" })) + "]"
        XCTAssertEqual(ts0, ts1)
        XCTAssertEqual(ts1, ts2)
    }
}
