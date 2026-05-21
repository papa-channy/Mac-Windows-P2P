// Categories.swift — §4.1 카테고리 매핑 단일 source of truth.
//
// Windows 측 contract (`WINDOWS_PARITY_BRIEF.md` §4.1)과 100% 동기화 유지.
// 추가/변경 시 양쪽 동시에 합의 후 반영.

import Foundation

public struct TransferCategory: Sendable, Hashable, Identifiable {
    public let key: String        // 영문 lower (네이밍 규칙·manifest에 사용)
    public let label: String      // 한글 라벨 (UI 표시)
    public let emoji: String      // 이모지 (UI 표시)
    public let folderCode: String // 셰어 내부 폴더 코드 (사용자에겐 노출 X)

    public var id: String { key }
}

public enum Categories {
    /// 표시 순서 = §3.4 드롭다운 순서. 끝의 `unsorted`(미분류)는 Mac 측 확장.
    public static let all: [TransferCategory] = [
        .init(key: "documents", label: "문서",     emoji: "📄", folderCode: "30_Documents"),
        .init(key: "data",      label: "데이터",   emoji: "📊", folderCode: "20_Data"),
        .init(key: "repos",     label: "코드",     emoji: "💻", folderCode: "10_Repos"),
        .init(key: "research",  label: "리서치",   emoji: "🔬", folderCode: "40_Research"),
        .init(key: "env",       label: "환경설정", emoji: "⚙",  folderCode: "50_Env"),
        .init(key: "builds",    label: "빌드",     emoji: "🛠", folderCode: "60_Builds"),
        .init(key: "assets",    label: "애셋",     emoji: "🎨", folderCode: "70_Assets"),
        .init(key: "misc",      label: "기타",     emoji: "📦", folderCode: "90_Misc"),
        // Mac 측 확장. LLM 자동 분류 전 임시 안착지.
        // Windows 측 §4.1에 동기화 필요 (Phase 5 sync 시점에 통보).
        .init(key: "unsorted",  label: "미분류",   emoji: "📥", folderCode: "99_Unsorted"),
    ]

    /// 단일 파일 우클릭 송신 기본값.
    public static let `default`: TransferCategory = byKey("documents")!

    /// 다중 파일 drag-drop 기본값 (LLM 분류 도입 전까지).
    public static let unsorted: TransferCategory = byKey("unsorted")!

    public static func byKey(_ key: String) -> TransferCategory? {
        all.first(where: { $0.key == key })
    }
}
