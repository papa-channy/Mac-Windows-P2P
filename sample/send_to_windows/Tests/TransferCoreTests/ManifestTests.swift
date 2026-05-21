import XCTest
@testable import TransferCore

final class ManifestTests: XCTestCase {

    private static let kst = TimeZone(identifier: "Asia/Seoul")!

    func test_transferID_format() {
        let date = ISO8601DateFormatter().date(from: "2026-05-17T21:20:55+09:00")!
        let id = Manifest.makeTransferID(
            date: date, direction: .macToWindows,
            categoryKey: "documents", batchName: "report",
            version: 1, timeZone: Self.kst
        )
        XCTAssertEqual(id, "2026-05-17T212055+0900__mac__windows__documents__report__v01")
    }

    func test_transferID_windowsToMac() {
        let date = ISO8601DateFormatter().date(from: "2026-05-16T02:38:09+09:00")!
        let id = Manifest.makeTransferID(
            date: date, direction: .windowsToMac,
            categoryKey: "documents", batchName: "planning-docs",
            version: 1, timeZone: Self.kst
        )
        XCTAssertEqual(id, "2026-05-16T023809+0900__windows__mac__documents__planning-docs__v01")
    }

    func test_encode_decode_roundTrip() throws {
        let m = sampleManifest()
        let data = try m.encodedJSON()
        let back = try Manifest.decode(from: data)
        XCTAssertEqual(m, back)
    }

    func test_encode_keysAreSorted_deterministic() throws {
        let m = sampleManifest()
        let d1 = try m.encodedJSON()
        let d2 = try m.encodedJSON()
        XCTAssertEqual(d1, d2, "encoding must be deterministic")

        let s = String(data: d1, encoding: .utf8)!
        // sortedKeys면 "batch_name"이 "category"보다 앞에 와야
        let bIdx = s.range(of: "\"batch_name\"")!.lowerBound
        let cIdx = s.range(of: "\"category\"")!.lowerBound
        XCTAssertLessThan(bIdx, cIdx)
    }

    func test_encode_containsExpectedFields() throws {
        let m = sampleManifest()
        let s = String(data: try m.encodedJSON(), encoding: .utf8)!
        // §4.5 필수 필드 — 모두 포함되어야
        for key in ["schema_version", "tool", "tool_version", "transfer_id", "created_at",
                    "direction", "category", "batch_name", "version",
                    "source", "destination", "mode", "files", "totals", "state",
                    "host", "user", "path", "share_path", "primary_file",
                    "size_bytes", "sha256", "mtime", "files_included", "bytes_out"] {
            XCTAssertTrue(s.contains("\"\(key)\""), "missing key: \(key)")
        }
    }

    func test_encode_state_isReady_byDefault() throws {
        let m = sampleManifest()
        let s = String(data: try m.encodedJSON(), encoding: .utf8)!
        XCTAssertTrue(s.contains("\"state\" : \"ready\""))
    }

    func test_decode_realWindowsShimManifest() throws {
        // 실제 Windows phase-1 shim이 보낸 매니페스트 (WINDOWS_PARITY_BRIEF §4.5 예시 구조 기준)
        let json = """
        {
          "schema_version": 1,
          "tool": "shareguard-protomanual",
          "tool_version": "0.0.1",
          "transfer_id": "2026-05-16T023809+0900__windows__mac__documents__planning-docs__v01",
          "created_at": "2026-05-16T02:38:09+09:00",
          "direction": "windows_to_mac",
          "category": "documents",
          "batch_name": "planning-docs",
          "version": 1,
          "source": { "host": "PC", "user": "u", "path": "D:\\\\Sample" },
          "destination": {
            "share_path": "10_Exchange/20_Windows_to_Mac/20_Ready/30_Documents/",
            "primary_file": "2026-05-16__documents__예상 공수 산정 근거__v01.html"
          },
          "mode": "file",
          "files": [
            { "path": "2026-05-16__documents__예상 공수 산정 근거__v01.html",
              "size_bytes": 18185,
              "sha256": "60d4b05463a760c79814db2835d2ea3b1d5d850cd55cad56d1478f8a5dfe4d50",
              "mtime": "2026-05-16T02:38:09+09:00" }
          ],
          "totals": { "files_included": 1, "bytes_out": 18185 },
          "state": "ready"
        }
        """
        let m = try Manifest.decode(from: json.data(using: .utf8)!)
        XCTAssertEqual(m.direction, "windows_to_mac")
        XCTAssertEqual(m.files.count, 1)
        XCTAssertEqual(m.files[0].size_bytes, 18185)
        XCTAssertEqual(m.files[0].sha256.prefix(8), "60d4b054")
        XCTAssertEqual(m.totals.files_included, 1)
    }

    // MARK: helper

    private func sampleManifest() -> Manifest {
        Manifest(
            schema_version: 1,
            tool: "send-to-windows.swift (phase-1 shim)",
            tool_version: "0.1.0",
            transfer_id: "2026-05-17T212055+0900__mac__windows__documents__report__v01",
            created_at: "2026-05-17T21:20:55+09:00",
            direction: "mac_to_windows",
            category: "documents",
            batch_name: "report",
            version: 1,
            source: .init(host: "MAC-31401A", user: "chan", path: "/Users/chan/Desktop/report.html"),
            destination: .init(
                share_path: "10_Exchange/10_Mac_to_Windows/20_Ready/30_Documents/",
                primary_file: "2026-05-17__documents__report__v01.html"),
            mode: "file",
            files: [.init(
                path: "2026-05-17__documents__report__v01.html",
                size_bytes: 18185,
                sha256: "f241b64ecb58c8ee34c43d83720deb5775db9c54f27a17fd58cd4069edc04c34",
                mtime: "2026-05-17T21:20:55+09:00")],
            totals: .init(files_included: 1, bytes_out: 18185),
            state: "ready"
        )
    }
}
