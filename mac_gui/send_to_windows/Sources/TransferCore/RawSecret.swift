// RawSecret.swift — §5.1 RAW_SECRET 차단 규칙.
//
// 대소문자 무시 매칭.
// 매치되면 전송 차단 → TransferError.rawSecretBlocked → exit 11.

import Foundation

public enum RawSecret {

    public struct Match: Sendable, Equatable {
        public let rule: String     // 사용자 표시용 이름 (".env (exact)" 등)
        public let pattern: String  // 매칭된 글롭 패턴 (".env", "*.pem" 등)
    }

    /// 파일/폴더 basename(경로 제외)에 대해 차단 여부 검사.
    /// 폴더 자체 이름도 검사 대상 — 폴더가 ".env" 이름이면 차단.
    public static func check(filename: String) -> Match? {
        let lower = filename.lowercased()

        // 1. Exact match (".env" 같이 점으로 시작하는 dotfile)
        if let m = exactMatches[lower] { return m }

        // 2. Suffix match (*.pem 류)
        for (suffix, match) in suffixMatches {
            if lower.hasSuffix(suffix) { return match }
        }

        // 3. Prefix+Suffix (service-account*.json)
        if lower.hasPrefix("service-account") && lower.hasSuffix(".json") {
            return Match(rule: "Service account JSON",
                         pattern: "service-account*.json")
        }

        return nil
    }

    /// 다수 검사 — 차단된 첫 번째 결과 반환. 전체 트리 walk에서 사용.
    public static func checkAny(filenames: [String]) -> (filename: String, match: Match)? {
        for name in filenames {
            if let m = check(filename: name) {
                return (name, m)
            }
        }
        return nil
    }

    // MARK: — Internal patterns

    private static let exactMatches: [String: Match] = [
        ".env":                Match(rule: ".env (exact)",     pattern: ".env"),
        ".env.production":     Match(rule: ".env.production",  pattern: ".env.production"),
        ".env.local":          Match(rule: ".env.local",       pattern: ".env.local"),
        ".env.development":    Match(rule: ".env.development", pattern: ".env.development"),
    ]

    private static let suffixMatches: [(String, Match)] = [
        (".pem",             Match(rule: "PEM file",         pattern: "*.pem")),
        (".key",             Match(rule: "Private key",      pattern: "*.key")),
        (".p12",             Match(rule: "PKCS#12 keystore", pattern: "*.p12")),
        (".mobileprovision", Match(rule: "iOS provisioning", pattern: "*.mobileprovision")),
    ]
}
