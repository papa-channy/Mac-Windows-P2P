// Log.swift — §4.7 phase-1 shim 로그 (plain text 3줄).
//
// 형식 (Windows shim 출력 미러):
//   [ts] context-menu send: <abs-src> -> <abs-dst>
//   [ts] mode=<file|directory|batch>  hash=<full-sha>  payload=<n> bytes
//   [ts] state=ready transfer_id=<transfer-id>
//
// 같은 ts를 3줄에 모두 적용 (호출 시점 기준).

import Foundation

public enum TransferLog {

    public static func render(transferID: String,
                              mode: TransferMode,
                              sourceAbsPath: String,
                              destAbsPath: String,
                              hashHex: String,
                              payloadBytes: Int64,
                              at: Date = .init(),
                              timeZone: TimeZone = .current,
                              entryKind: String = "context-menu send") -> String {
        let ts = "[\(Timestamps.logTimestamp(at, timeZone: timeZone))]"
        return """
        \(ts) \(entryKind): \(sourceAbsPath) -> \(destAbsPath)
        \(ts) mode=\(mode.rawValue)  hash=\(hashHex)  payload=\(payloadBytes) bytes
        \(ts) state=ready transfer_id=\(transferID)

        """
    }
}
