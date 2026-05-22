import XCTest
@testable import TransferCore

final class RawSecretTests: XCTestCase {

    // MARK: 차단되어야 하는 케이스

    func test_blocks_dotenv_exact() {
        let m = RawSecret.check(filename: ".env")
        XCTAssertEqual(m?.pattern, ".env")
        XCTAssertEqual(m?.rule, ".env (exact)")
    }

    func test_blocks_dotenv_production() {
        XCTAssertEqual(RawSecret.check(filename: ".env.production")?.pattern, ".env.production")
        XCTAssertEqual(RawSecret.check(filename: ".env.local")?.pattern, ".env.local")
        XCTAssertEqual(RawSecret.check(filename: ".env.development")?.pattern, ".env.development")
    }

    func test_blocks_pem() {
        XCTAssertEqual(RawSecret.check(filename: "server.pem")?.pattern, "*.pem")
        XCTAssertEqual(RawSecret.check(filename: "cert.PEM")?.pattern, "*.pem")  // 대소문자 무시
    }

    func test_blocks_key() {
        XCTAssertEqual(RawSecret.check(filename: "private.key")?.pattern, "*.key")
        XCTAssertEqual(RawSecret.check(filename: "id_rsa.key")?.pattern, "*.key")
    }

    func test_blocks_p12() {
        XCTAssertEqual(RawSecret.check(filename: "identity.p12")?.pattern, "*.p12")
    }

    func test_blocks_mobileprovision() {
        XCTAssertEqual(RawSecret.check(filename: "AppStore.mobileprovision")?.pattern,
                       "*.mobileprovision")
    }

    func test_blocks_serviceAccountJson() {
        XCTAssertEqual(RawSecret.check(filename: "service-account.json")?.pattern,
                       "service-account*.json")
        XCTAssertEqual(RawSecret.check(filename: "service-account-prod.json")?.pattern,
                       "service-account*.json")
        XCTAssertEqual(RawSecret.check(filename: "Service-Account.JSON")?.pattern,  // 대소문자
                       "service-account*.json")
    }

    // MARK: 차단되면 안 되는 케이스 (false positive 방지)

    func test_allows_dotenv_example() {
        XCTAssertNil(RawSecret.check(filename: ".env.example"))
        XCTAssertNil(RawSecret.check(filename: ".env.template"))
        XCTAssertNil(RawSecret.check(filename: ".env.sample"))
    }

    func test_allows_dotenv_encrypted() {
        XCTAssertNil(RawSecret.check(filename: ".env.encrypted"))
    }

    func test_allows_publicCertSuffix() {
        XCTAssertNil(RawSecret.check(filename: "public.crt"))   // *.crt는 비-시크릿
        XCTAssertNil(RawSecret.check(filename: "public.cer"))
    }

    func test_allows_pemInName_butNotSuffix() {
        XCTAssertNil(RawSecret.check(filename: "pem-howto.md"))  // ".pem"으로 끝나야만
        XCTAssertNil(RawSecret.check(filename: "report.html"))
    }

    func test_allows_serviceAccountVariations_thatDontMatch() {
        // "service-account*.json" — prefix + suffix 둘 다 만족해야
        XCTAssertNil(RawSecret.check(filename: "service-account-readme.md"))
        XCTAssertNil(RawSecret.check(filename: "some-other-service-account.json"))  // prefix X
    }

    func test_allows_korean_filename() {
        XCTAssertNil(RawSecret.check(filename: "예상 공수 산정 근거.html"))
    }

    // MARK: checkAny

    func test_checkAny_findsFirstBlocked() {
        let result = RawSecret.checkAny(filenames: [
            "normal.txt",
            "image.png",
            "service-account.json",  // 첫 차단
            ".env",                  // 두 번째 차단 (반환되지 않음)
        ])
        XCTAssertEqual(result?.filename, "service-account.json")
        XCTAssertEqual(result?.match.pattern, "service-account*.json")
    }

    func test_checkAny_returnsNilWhenAllOK() {
        let result = RawSecret.checkAny(filenames: [
            "report.html", "image.png", ".env.example",
        ])
        XCTAssertNil(result)
    }
}
