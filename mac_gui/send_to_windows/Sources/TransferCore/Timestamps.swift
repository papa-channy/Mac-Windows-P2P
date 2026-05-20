// Timestamps.swift — §4.3 / §4.5 시각 포맷.
//
// 두 가지 형식 사용:
//   - 파일명 prefix:  YYYY-MM-DD                 (date only, local time)
//   - transfer_id:    YYYY-MM-DDTHHmmss+ZZZZ     (no colon in timezone)
//   - manifest created_at: ISO 8601               (with colon in timezone, RFC 3339)

import Foundation

public enum Timestamps {

    /// "2026-05-18" — 파일명 prefix용.
    public static func filenameDate(_ date: Date = .init(),
                                    timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// "2026-05-18T152055+0900" — transfer_id용 (콜론 없는 타임존).
    public static func transferIDTimestamp(_ date: Date = .init(),
                                           timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd'T'HHmmssZ"  // Z = +0900 형식
        return f.string(from: date)
    }

    /// "2026-05-18T15:20:55+09:00" — manifest created_at용 (RFC 3339).
    public static func iso8601(_ date: Date = .init(),
                               timeZone: TimeZone = .current) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        f.timeZone = timeZone
        return f.string(from: date)
    }

    /// "2026-05-18T15:20:55.0319495+09:00" — phase-1 shim log용 (마이크로초 정밀도).
    public static func logTimestamp(_ date: Date = .init(),
                                    timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSSSxxx"
        return f.string(from: date)
    }
}
