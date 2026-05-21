// ResultDialog.swift — §2.6 결과 다이얼로그.
// 성공 뱃지 ✓ + 카드(파일명/카테고리/SHA-256) + 확인 단일 버튼.

import SwiftUI
import TransferCore

public struct ResultDialog: View {
    public let primaryFilename: String
    public let category: TransferCategory
    public let sha256: String
    public var onConfirm: () -> Void

    public init(primaryFilename: String,
                category: TransferCategory,
                sha256: String,
                onConfirm: @escaping () -> Void) {
        self.primaryFilename = primaryFilename
        self.category = category
        self.sha256 = sha256
        self.onConfirm = onConfirm
    }

    public var body: some View {
        VStack(spacing: 0) {
            ResultHeader()
            body_
            FooterBar(primaryLabel: "확인", onCancel: nil, onConfirm: onConfirm)
        }
        .frame(width: Theme.Layout.dialogWidth)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.outerCorner,
                                    style: .continuous))
        .background(KeyHandler(onEscape: onConfirm, onReturn: onConfirm))
        .preferredColorScheme(.dark)
    }

    private var body_: some View {
        VStack(alignment: .leading, spacing: 14) {
            Card {
                row(label: "파일명", value: primaryFilename, mono: false)
                Divider().background(Theme.border1.opacity(0.5))
                row(label: "카테고리", value: "\(category.emoji)  \(category.label)", mono: false)
                Divider().background(Theme.border1.opacity(0.5))
                row(label: "SHA-256", value: sha256, mono: true)
            }
        }
        .padding(.horizontal, Theme.Layout.bodyPaddingH)
        .padding(.vertical,   Theme.Layout.bodyPaddingV)
    }

    private func row(label: String, value: String, mono: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(Theme.Typography.caption())
                .foregroundColor(Theme.textSec)
            Text(value)
                .font(mono ? Theme.Typography.mono() : Theme.Typography.body())
                .foregroundColor(Theme.textPri)
                .textSelection(.enabled)
                .lineLimit(mono ? 2 : 1)
                .truncationMode(mono ? .tail : .middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }
}

struct ResultHeader: View {
    var body: some View {
        ZStack {
            DraggableHeaderBackground()
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Theme.success)
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                }
                .frame(width: 26, height: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text("전송 완료")
                        .font(Theme.Typography.title())
                        .foregroundColor(Theme.textPri)
                    Text("Windows가 공유폴더에서 받을 수 있어요")
                        .font(Theme.Typography.caption())
                        .foregroundColor(Theme.textSec)
                }
                Spacer()
            }
            .padding(.horizontal, Theme.Layout.bodyPaddingH)
        }
        .frame(height: Theme.Layout.headerHeight + 12)  // 부제 들어가서 살짝 키움
    }
}

/// 단순 카드 컨테이너.
struct Card<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(.horizontal, Theme.Layout.cardPaddingH)
        .padding(.vertical,   Theme.Layout.cardPaddingV)
        .background(Theme.surface2)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Layout.cardCorner, style: .continuous)
                .stroke(Theme.border1, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.cardCorner,
                                    style: .continuous))
    }
}
