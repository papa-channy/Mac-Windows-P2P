// ShareMount.swift — 셰어 마운트 상태 감지 + 필요시 mw CLI 호출.
//
// mw mount는 idempotent이므로 매번 호출해도 안전.
// 우선순위:
//   1. /Volumes/Mac-Window_Share         (Finder/NetAuth 표준 경로)
//   2. ~/mnt/Mac-Window_Share            (mw 폴백 경로)
//   3. 이외 SMB 마운트에서 셰어명 매칭 (mount 출력 파싱)
//
// 마운트 안 됐고 mw도 못 부르면 nil 반환 → 호출자가 UI 알림.

import Foundation

public enum ShareMount {

    /// 사용자 설정 가능 (테스트용).
    public static var mwCLIPath: String =
        "\(NSHomeDirectory())/Library/Application Support/MacWindowShare/mw"

    /// 현재 마운트된 셰어의 URL. 없으면 nil.
    public static func currentMountURL() -> URL? {
        // 1. 우선 표준 경로 두 개 확인
        let fm = FileManager.default
        let candidates: [String] = [
            "/Volumes/Mac-Window_Share",
            "\(NSHomeDirectory())/mnt/Mac-Window_Share",
        ]
        for path in candidates {
            if fm.fileExists(atPath: path), isShareMountPoint(path) {
                return URL(fileURLWithPath: path)
            }
        }
        // 2. mount 출력 파싱 (커스텀 마운트 포인트 잡기)
        if let mp = parseMountOutput() {
            return URL(fileURLWithPath: mp)
        }
        return nil
    }

    /// 마운트 시도. 이미 마운트면 즉시 현재 URL 반환.
    /// mw가 없거나 실패하면 nil.
    @discardableResult
    public static func ensureMounted(timeout: TimeInterval = 12) -> URL? {
        if let url = currentMountURL() { return url }
        guard FileManager.default.isExecutableFile(atPath: mwCLIPath) else {
            return nil
        }
        // mw mount 호출 (foreground, 응답 대기)
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: mwCLIPath)
        proc.arguments = ["mount"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe
        do {
            try proc.run()
        } catch {
            return nil
        }
        // 별도 스레드에서 timeout 모니터링
        let deadline = Date().addingTimeInterval(timeout)
        while proc.isRunning {
            if Date() > deadline {
                proc.terminate()
                return nil
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        // 짧게 polling — mw 종료 직후 mount 인덱스 안 잡힐 수 있음
        for _ in 0..<10 {
            if let url = currentMountURL() { return url }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return currentMountURL()
    }

    // MARK: — Internal

    /// /Volumes/<X> 경로가 우리 셰어인지 휴리스틱 — 디렉터리 존재 + 내부 마커 확인.
    private static func isShareMountPoint(_ path: String) -> Bool {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue
        else { return false }
        // 셰어 루트의 알려진 폴더 마커 (00_System 또는 10_Exchange)
        return fm.fileExists(atPath: "\(path)/00_System") ||
               fm.fileExists(atPath: "\(path)/10_Exchange")
    }

    /// `mount` 명령 출력에서 Mac-Window_Share 마운트 포인트 추출.
    private static func parseMountOutput() -> String? {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/sbin/mount")
        let pipe = Pipe()
        proc.standardOutput = pipe
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let out = String(data: data, encoding: .utf8) else { return nil }
        for line in out.split(separator: "\n") {
            guard line.contains("/Mac-Window_Share") else { continue }
            // 형식: "//user@host/Mac-Window_Share on /Volumes/Mac-Window_Share (smbfs, ...)"
            guard let onRange = line.range(of: " on ") else { continue }
            let after = line[onRange.upperBound...]
            // 첫 " (" 위치까지가 마운트 경로
            if let parenIdx = after.firstIndex(of: "(") {
                let raw = after[..<parenIdx]
                let mp = raw.trimmingCharacters(in: .whitespaces)
                return mp
            }
        }
        return nil
    }
}
