// FolderAccess.swift — 파일 탐색기 시작 위치 영구화.
//
// **중요한 사실**:
// - `[.withSecurityScope]` 옵션은 **sandbox 앱 전용**. 우리 앱은 non-sandbox이므로
//   그 옵션 쓰면 오히려 stale 판정 등 부작용. 일반 bookmark만 사용.
// - non-sandbox 앱에서 TCC 보호 폴더(Desktop/Documents/Downloads) 접근은
//   **CDHash 기반 grant**로 처리됨. ad-hoc 빌드라 CDHash 매번 변함 → 매번 재프롬프트.
//   영구 해결책은 안정 codesign 인증서 (scripts/bundle-app.sh 참고).
//
// 이 모듈의 역할은 좁게:
// - 사용자가 "권한 부여" 흐름에서 NSOpenPanel로 루트 폴더 선택
// - 그 URL을 bookmark로 UserDefaults에 저장 → 다음 실행에서 같은 위치로 자동 복귀
// - TCC 차단은 system이 알아서 (Full Disk Access 켜두면 영구 해결)

import AppKit
import Darwin
import Foundation

public enum FolderAccess {

    private static let bookmarkKey = "SendToWindows.RootFolderBookmark"

    // MARK: — 상태

    /// 저장된 bookmark 있는지 (단순 데이터 존재 체크).
    public static var hasGrant: Bool {
        UserDefaults.standard.data(forKey: bookmarkKey) != nil
    }

    /// 전체 디스크 접근(Full Disk Access) 부여 여부 추정.
    /// 일반적으로 FDA가 있으면 보호 경로 직접 read 가능. POSIX `access()` 로
    /// 침투성 없는 probe (UI 다이얼로그 안 띄움).
    /// Mail/Messages/TCC.db 중 하나라도 접근 가능하면 true.
    public static var hasFullDiskAccess: Bool {
        let home = NSHomeDirectory() as NSString
        let candidates = [
            "Library/Mail",
            "Library/Messages",
            "Library/Application Support/com.apple.TCC/TCC.db",
            "Library/Safari/History.db",
        ]
        let fm = FileManager.default
        for c in candidates {
            let path = home.appendingPathComponent(c)
            if fm.fileExists(atPath: path) {
                return access(path, R_OK) == 0
            }
        }
        // 후보가 다 없는 환경 → 알 수 없음 (false 처리; 사용자에게 prompt 노출)
        return false
    }

    /// 시스템 설정 → 개인정보 보호 → 전체 디스크 접근 패널 열기 +
    /// Finder에 자기 자신 (.app)을 띄워서 FDA 패널로 drag-drop 가능하게.
    public static func openFullDiskAccessSettings() {
        let url = URL(string:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!
        NSWorkspace.shared.open(url)

        // 0.6s 뒤 Finder에 .app 자기 자신 띄움 — 두 윈도우 나란히 보이게.
        // (System Settings는 새로 열리는 데 약간 시간 걸려서 약간 대기)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            revealSelfInFinder()
        }
    }

    /// 현재 실행 중인 .app 파일을 Finder에서 선택 상태로 띄움.
    /// 사용자가 그 아이콘을 시스템 설정의 FDA 리스트로 drag-drop 할 수 있음.
    public static func revealSelfInFinder() {
        let appURL = URL(fileURLWithPath: Bundle.main.bundlePath)
        NSWorkspace.shared.activateFileViewerSelecting([appURL])
    }

    /// 시스템 설정 → 파일과 폴더 패널 열기 (보조 옵션).
    public static func openFilesAndFoldersSettings() {
        let url = URL(string:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders")!
        NSWorkspace.shared.open(url)
    }

    /// 저장된 bookmark을 resolve한 URL. stale이면 자동 갱신만 시도 (제거는 하지 않음).
    public static func resolvedRoot() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        let url: URL?
        do {
            // ★ [.withSecurityScope] 빼고 일반 bookmark 사용 (non-sandbox 앱에서는
            //    이 옵션이 false stale을 반환할 수 있음)
            url = try URL(resolvingBookmarkData: data,
                          options: [],
                          relativeTo: nil,
                          bookmarkDataIsStale: &stale)
        } catch {
            return nil
        }
        guard let url else { return nil }
        if stale {
            // 그냥 새 bookmark로 갱신 시도 (URL은 유효)
            _ = saveBookmark(for: url)
        }
        return url
    }

    // MARK: — Grant 요청 (NSOpenPanel)

    /// 사용자에게 루트 폴더 권한 요청. OK면 bookmark 저장 + URL 반환.
    @MainActor
    public static func requestGrant() -> URL? {
        // 비-foreground 앱이라 panel을 위로 올리기 위해 활성화 먼저.
        NSApp.activate(ignoringOtherApps: true)

        let panel = NSOpenPanel()
        panel.title = "폴더 접근 권한"
        panel.message = """
        파일 탐색의 시작 위치를 한 번만 선택해주세요. \
        보통 홈 폴더(~/) 또는 자주 쓰는 작업 폴더를 선택합니다. \
        선택 위치는 다음 실행 시에도 기억됩니다.
        """
        panel.prompt = "이 폴더 사용"
        panel.directoryURL = URL(fileURLWithPath: NSHomeDirectory())
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.level = .modalPanel  // 다른 윈도우 위로

        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        _ = saveBookmark(for: url)
        return url
    }

    /// 즉시 사용 가능한 root URL 확보:
    /// 1. 저장된 bookmark resolve → 있으면 그 URL
    /// 2. 없으면 사용자에게 grant 요청 → 선택한 URL
    /// 3. 둘 다 실패면 nil
    @MainActor
    public static func ensureAccessibleRoot() -> URL? {
        if let url = resolvedRoot() { return url }
        return requestGrant()
    }

    /// grant 해제 (재설정용).
    public static func revoke() {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
    }

    // MARK: — 내부

    @discardableResult
    private static func saveBookmark(for url: URL) -> Bool {
        do {
            let data = try url.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            UserDefaults.standard.set(data, forKey: bookmarkKey)
            return true
        } catch {
            return false
        }
    }
}
