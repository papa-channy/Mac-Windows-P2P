// CategoriesTests.swift — §4.1 매핑 contract 회귀 방지.
//
// 이 테스트가 깨지면 Windows 측 매핑과 어긋남 → 즉시 양쪽 동기화 필요.

import XCTest
@testable import TransferCore

final class CategoriesTests: XCTestCase {

    /// §4.1 정규형 키 9개 (Windows 8개 + Mac 확장 unsorted)
    private static let expectedKeys: [String] = [
        "documents", "data", "repos", "research",
        "env", "builds", "assets", "misc", "unsorted",
    ]

    func test_AllKeysPresentInOrder() {
        let keys = Categories.all.map(\.key)
        XCTAssertEqual(keys, Self.expectedKeys)
    }

    func test_DefaultIsDocuments() {
        XCTAssertEqual(Categories.default.key, "documents")
    }

    func test_UnsortedIsLast() {
        XCTAssertEqual(Categories.all.last?.key, "unsorted")
        XCTAssertEqual(Categories.unsorted.label, "미분류")
        XCTAssertEqual(Categories.unsorted.folderCode, "99_Unsorted")
    }

    func test_FolderCodesMatchSpec() {
        let expected: [(String, String)] = [
            ("documents", "30_Documents"),
            ("data",      "20_Data"),
            ("repos",     "10_Repos"),
            ("research",  "40_Research"),
            ("env",       "50_Env"),
            ("builds",    "60_Builds"),
            ("assets",    "70_Assets"),
            ("misc",      "90_Misc"),
            ("unsorted",  "99_Unsorted"),
        ]
        for (key, folder) in expected {
            XCTAssertEqual(Categories.byKey(key)?.folderCode, folder,
                           "folderCode mismatch for \(key)")
        }
    }

    func test_LabelsMatchSpec() {
        let expected: [(String, String)] = [
            ("documents", "문서"),
            ("data",      "데이터"),
            ("repos",     "코드"),
            ("research",  "리서치"),
            ("env",       "환경설정"),
            ("builds",    "빌드"),
            ("assets",    "애셋"),
            ("misc",      "기타"),
            ("unsorted",  "미분류"),
        ]
        for (key, label) in expected {
            XCTAssertEqual(Categories.byKey(key)?.label, label)
        }
    }

    func test_ByKeyUnknownReturnsNil() {
        XCTAssertNil(Categories.byKey("nonexistent"))
        XCTAssertNil(Categories.byKey(""))
    }

    func test_KeysAreUnique() {
        let keys = Categories.all.map(\.key)
        XCTAssertEqual(Set(keys).count, keys.count, "중복 키 발견")
    }

    func test_FolderCodesAreUnique() {
        let folders = Categories.all.map(\.folderCode)
        XCTAssertEqual(Set(folders).count, folders.count, "중복 folderCode 발견")
    }
}
