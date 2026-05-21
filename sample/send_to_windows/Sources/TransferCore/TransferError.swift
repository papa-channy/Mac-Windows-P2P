// TransferError.swift — Engine이 던지는 에러. §5.3 exit code와 매핑.

import Foundation

public enum TransferError: Error, Sendable, CustomStringConvertible {
    case rawSecretBlocked(filename: String, rule: String, pattern: String) // exit 11
    case ioError(String, underlying: Error?)                                // exit 20
    case usageError(String)                                                 // exit 64
    case shareNotMounted(expectedPath: String)
    case destinationExists(path: String)                                    // 덮어쓰기 확인 필요 신호

    public var description: String {
        switch self {
        case let .rawSecretBlocked(name, rule, pattern):
            return "BLOCKED by RAW_SECRET rule (\(rule), matched: \(pattern)): \(name)"
        case let .ioError(msg, err):
            if let err { return "I/O error: \(msg) — \(err)" }
            return "I/O error: \(msg)"
        case let .usageError(msg):
            return "Usage error: \(msg)"
        case let .shareNotMounted(path):
            return "Share not mounted (expected at \(path))"
        case let .destinationExists(path):
            return "Destination exists: \(path) — overwrite confirmation required"
        }
    }

    /// §5.3 exit code.
    public var exitCode: Int32 {
        switch self {
        case .rawSecretBlocked:  return 11
        case .ioError:           return 20
        case .shareNotMounted:   return 20
        case .destinationExists: return 0  // 사용자 confirm 필요 — 에러 아닌 신호
        case .usageError:        return 64
        }
    }
}
