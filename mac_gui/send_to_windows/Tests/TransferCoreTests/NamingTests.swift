import XCTest
@testable import TransferCore

final class NamingTests: XCTestCase {

    // MARK: render

    func test_render_simple() {
        let c = Naming.Components(date: "2026-05-18", categoryKey: "documents",
                                  basename: "report", version: 1, ext: ".html")
        XCTAssertEqual(Naming.render(c),
                       "2026-05-18__documents__report__v01.html")
    }

    func test_render_korean_basename_with_spaces() {
        let c = Naming.Components(date: "2026-05-16", categoryKey: "documents",
                                  basename: "예상 공수 산정 근거", version: 1, ext: ".html")
        XCTAssertEqual(Naming.render(c),
                       "2026-05-16__documents__예상 공수 산정 근거__v01.html")
    }

    func test_render_folder_no_ext() {
        let c = Naming.Components(date: "2026-05-18", categoryKey: "repos",
                                  basename: "my-project", version: 12, ext: "")
        XCTAssertEqual(Naming.render(c),
                       "2026-05-18__repos__my-project__v12")
    }

    func test_render_versionPaddedToTwoDigits() {
        let c1 = Naming.Components(date: "2026-05-18", categoryKey: "data",
                                   basename: "x", version: 1, ext: ".csv")
        XCTAssertTrue(Naming.render(c1).contains("__v01."))

        let c99 = Naming.Components(date: "2026-05-18", categoryKey: "data",
                                    basename: "x", version: 99, ext: ".csv")
        XCTAssertTrue(Naming.render(c99).contains("__v99."))
    }

    // MARK: split

    func test_split_file_simpleExt() {
        let url = URL(fileURLWithPath: "/tmp/report.html")
        let (base, ext) = Naming.split(originalURL: url, isDirectory: false)
        XCTAssertEqual(base, "report")
        XCTAssertEqual(ext, ".html")
    }

    func test_split_file_koreanName() {
        let url = URL(fileURLWithPath: "/tmp/예상 공수 산정 근거.html")
        let (base, ext) = Naming.split(originalURL: url, isDirectory: false)
        XCTAssertEqual(base, "예상 공수 산정 근거")
        XCTAssertEqual(ext, ".html")
    }

    func test_split_folder_noExt() {
        let url = URL(fileURLWithPath: "/tmp/my-project")
        let (base, ext) = Naming.split(originalURL: url, isDirectory: true)
        XCTAssertEqual(base, "my-project")
        XCTAssertEqual(ext, "")
    }

    func test_split_folder_evenWithDotInName_keepsItAsBasename() {
        let url = URL(fileURLWithPath: "/tmp/my.project.dir")
        let (base, ext) = Naming.split(originalURL: url, isDirectory: true)
        XCTAssertEqual(base, "my.project.dir")
        XCTAssertEqual(ext, "")
    }

    func test_split_dotfile_treatedAsNoExt() {
        // ".env" 같이 첫 글자가 '.'인 dotfile은 ext 없는 것으로.
        let url = URL(fileURLWithPath: "/tmp/.env")
        let (base, ext) = Naming.split(originalURL: url, isDirectory: false)
        XCTAssertEqual(base, ".env")
        XCTAssertEqual(ext, "")
    }

    func test_split_multipleDots_takesLast() {
        let url = URL(fileURLWithPath: "/tmp/archive.tar.gz")
        let (base, ext) = Naming.split(originalURL: url, isDirectory: false)
        XCTAssertEqual(base, "archive.tar")
        XCTAssertEqual(ext, ".gz")
    }

    // MARK: render (with URL convenience)

    func test_renderFromURL_file() {
        let url = URL(fileURLWithPath: "/tmp/report.html")
        let cat = Categories.byKey("documents")!
        let tz = TimeZone(identifier: "Asia/Seoul")!
        let date = ISO8601DateFormatter().date(from: "2026-05-18T15:20:55+09:00")!
        let out = Naming.render(date: date, category: cat,
                                originalURL: url, isDirectory: false,
                                version: 1, timeZone: tz)
        XCTAssertEqual(out, "2026-05-18__documents__report__v01.html")
    }

    func test_renderFromURL_folder_noExt() {
        let url = URL(fileURLWithPath: "/tmp/my-project")
        let cat = Categories.byKey("repos")!
        let tz = TimeZone(identifier: "Asia/Seoul")!
        let date = ISO8601DateFormatter().date(from: "2026-05-18T15:20:55+09:00")!
        let out = Naming.render(date: date, category: cat,
                                originalURL: url, isDirectory: true,
                                version: 3, timeZone: tz)
        XCTAssertEqual(out, "2026-05-18__repos__my-project__v03")
    }

    // MARK: parse round-trip

    func test_parse_simple() {
        let c = Naming.parse("2026-05-18__documents__report__v01.html")
        XCTAssertEqual(c?.date, "2026-05-18")
        XCTAssertEqual(c?.categoryKey, "documents")
        XCTAssertEqual(c?.basename, "report")
        XCTAssertEqual(c?.version, 1)
        XCTAssertEqual(c?.ext, ".html")
    }

    func test_parse_koreanWithSpaces() {
        let c = Naming.parse("2026-05-16__documents__예상 공수 산정 근거__v01.html")
        XCTAssertEqual(c?.basename, "예상 공수 산정 근거")
        XCTAssertEqual(c?.ext, ".html")
    }

    func test_parse_folder_noExt() {
        let c = Naming.parse("2026-05-18__repos__my-project__v12")
        XCTAssertEqual(c?.basename, "my-project")
        XCTAssertEqual(c?.version, 12)
        XCTAssertEqual(c?.ext, "")
    }

    func test_parse_basenameContainsDoubleUnderscore_preserves() {
        // "my__report" → 끝에서부터 v토큰 분리하므로 basename 내부 "__" 보존.
        let c = Naming.parse("2026-05-18__documents__my__report__v02.txt")
        XCTAssertEqual(c?.basename, "my__report")
        XCTAssertEqual(c?.version, 2)
    }

    func test_parse_archiveTarGz() {
        let c = Naming.parse("2026-05-18__data__archive.tar__v05.gz")
        XCTAssertEqual(c?.basename, "archive.tar")
        XCTAssertEqual(c?.ext, ".gz")
        XCTAssertEqual(c?.version, 5)
    }

    func test_parse_invalidFormat_returnsNil() {
        XCTAssertNil(Naming.parse("nothing-special.html"))
        XCTAssertNil(Naming.parse("2026-5-18__documents__x__v01.html"))      // date format
        XCTAssertNil(Naming.parse("2026-05-18__documents__x__v1.html"))      // 1-digit version
        XCTAssertNil(Naming.parse("2026-05-18__documents__x.html"))          // no version token
        XCTAssertNil(Naming.parse("2026-05-18__documents____v01.html"))      // empty basename
    }

    // MARK: round-trip

    func test_roundTrip_render_parse() {
        let inputs: [Naming.Components] = [
            .init(date: "2026-05-18", categoryKey: "documents",
                  basename: "report",                version: 1,  ext: ".html"),
            .init(date: "2026-05-16", categoryKey: "documents",
                  basename: "예상 공수 산정 근거", version: 1,  ext: ".html"),
            .init(date: "2026-05-18", categoryKey: "repos",
                  basename: "my-project",            version: 12, ext: ""),
            .init(date: "2026-05-18", categoryKey: "data",
                  basename: "my__report",            version: 99, ext: ".csv"),
        ]
        for input in inputs {
            let rendered = Naming.render(input)
            let parsed = Naming.parse(rendered)
            XCTAssertEqual(parsed, input, "round-trip failed for: \(rendered)")
        }
    }
}
