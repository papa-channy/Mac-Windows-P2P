// ReceivedView.swift — Phase 4 placeholder.
// Windows→Mac 수신 파일을 카테고리 트리로 탐색.

import SwiftUI

public struct ReceivedView: View {
    public var onBack: () -> Void
    public var onQuit: () -> Void

    public init(onBack: @escaping () -> Void, onQuit: @escaping () -> Void) {
        self.onBack = onBack
        self.onQuit = onQuit
    }

    public var body: some View {
        VStack(spacing: 0) {
            SecondaryHeader(title: "받은 파일", onBack: onBack, onClose: onQuit)
            VStack(spacing: 14) {
                Image(systemName: "tray.full")
                    .font(.system(size: 48))
                    .foregroundColor(Theme.textSec)
                Text("Phase 4 자리")
                    .font(Theme.Typography.title())
                    .foregroundColor(Theme.textPri)
                Text("Windows→Mac 수신 파일 트리 + 다운로드 + 검증 — 다음 사이클에 구현")
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(minWidth: 720, minHeight: 460)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.outerCorner,
                                    style: .continuous))
        .preferredColorScheme(.dark)
    }
}
