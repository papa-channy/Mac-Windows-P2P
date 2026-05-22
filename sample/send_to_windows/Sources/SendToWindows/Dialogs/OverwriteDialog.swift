// OverwriteDialog.swift — §5.2 덮어쓰기 확인.
// 같은 다크 테마 + danger 색상으로 위험 강조.

import SwiftUI

public struct OverwriteDialog: View {
    public let existingPath: String
    public var onCancel: () -> Void
    public var onOverwrite: () -> Void

    public init(existingPath: String,
                onCancel: @escaping () -> Void,
                onOverwrite: @escaping () -> Void) {
        self.existingPath = existingPath
        self.onCancel = onCancel
        self.onOverwrite = onOverwrite
    }

    public var body: some View {
        VStack(spacing: 0) {
            WarnHeader()
            body_
            FooterBar(
                primaryLabel: "덮어쓰기",
                onCancel: onCancel,
                onConfirm: onOverwrite
            )
            .environment(\.dangerPrimary, true)
        }
        .frame(width: Theme.Layout.dialogWidth)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.outerCorner,
                                    style: .continuous))
        .background(KeyHandler(onEscape: onCancel, onReturn: onOverwrite))
        .preferredColorScheme(.dark)
    }

    private var body_: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("같은 이름의 항목이 도착지에 이미 있습니다.")
                .font(Theme.Typography.body())
                .foregroundColor(Theme.textPri)
            Card {
                VStack(alignment: .leading, spacing: 4) {
                    Text("도착 경로")
                        .font(Theme.Typography.caption())
                        .foregroundColor(Theme.textSec)
                    Text(existingPath)
                        .font(Theme.Typography.mono())
                        .foregroundColor(Theme.textPri)
                        .lineLimit(3)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("덮어쓰면 기존 파일/폴더는 즉시 삭제됩니다. 되돌릴 수 없습니다.")
                .font(Theme.Typography.caption())
                .foregroundColor(Theme.danger)
        }
        .padding(.horizontal, Theme.Layout.bodyPaddingH)
        .padding(.vertical,   Theme.Layout.bodyPaddingV)
    }
}

private struct WarnHeader: View {
    var body: some View {
        ZStack {
            DraggableHeaderBackground()
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 16))
                    .foregroundColor(Theme.danger)
                Text("덮어쓰기 확인")
                    .font(Theme.Typography.title())
                    .foregroundColor(Theme.textPri)
                Spacer()
            }
            .padding(.horizontal, Theme.Layout.bodyPaddingH)
        }
        .frame(height: Theme.Layout.headerHeight)
    }
}

// MARK: — Environment toggle (FooterBar의 primary 색상 빨강으로 바꾸기)

private struct DangerPrimaryKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var dangerPrimary: Bool {
        get { self[DangerPrimaryKey.self] }
        set { self[DangerPrimaryKey.self] = newValue }
    }
}
