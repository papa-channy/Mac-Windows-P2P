// TransferMode.swift — §4.5 manifest의 mode 필드.
//
// Phase 1-2: file, directory.
// Phase 3 추가: batch (다중 drag-drop). Windows 측에 forward-compat 협의 필요.

import Foundation

public enum TransferMode: String, Sendable, Codable {
    case file
    case directory
    case batch  // Mac 측 확장 — 다중 파일/폴더 한 transfer_id로 묶음
}
