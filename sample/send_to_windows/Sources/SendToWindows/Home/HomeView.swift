// HomeView.swift — 진입 화면. 3 개의 큰 버튼.
//
// 사용자 spec:
//   ① 파일 보내기            → SendView (Phase 3)
//   ② 받은 파일 확인하기      → ReceivedView (Phase 4)
//   ③ 보낸 파일 확인하기      → SentView (Phase 5)
//
// Phase 4-5은 아직 placeholder.

import SwiftUI

public enum HomeDestination: Hashable {
    case send
    case received
    case sent
}

public struct HomeView: View {
    public var onPick: (HomeDestination) -> Void
    public var onQuit: () -> Void

    public init(onPick: @escaping (HomeDestination) -> Void,
                onQuit: @escaping () -> Void) {
        self.onPick = onPick
        self.onQuit = onQuit
    }

    public var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Mac ↔ Windows Share", onClose: onQuit)
            content
        }
        .frame(width: 720, height: 460)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.outerCorner,
                                    style: .continuous))
        .preferredColorScheme(.dark)
    }

    private var content: some View {
        VStack(spacing: 22) {
            Spacer().frame(height: 6)
            Text("어떤 작업을 시작할까요?")
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Theme.textPri)
            VStack(spacing: 14) {
                HomeButton(emoji: "📤", title: "파일 보내기",
                           subtitle: "드래그앤드롭으로 Windows로 한 번에 전송",
                           onTap: { onPick(.send) })
                HomeButton(emoji: "📥", title: "받은 파일 확인하기",
                           subtitle: "Windows에서 보내준 파일을 카테고리 트리로 탐색",
                           onTap: { onPick(.received) })
                HomeButton(emoji: "🗂", title: "보낸 파일 확인하기",
                           subtitle: "내가 언제·뭘 보냈는지 히스토리 확인",
                           onTap: { onPick(.sent) })
            }
            Spacer()
        }
        .padding(.horizontal, 40)
        .padding(.vertical, 24)
    }
}

private struct HomeButton: View {
    let emoji: String
    let title: String
    let subtitle: String
    var onTap: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                Text(emoji)
                    .font(.system(size: 36))
                    .frame(width: 56, height: 56)
                    .background(Theme.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 12,
                                                style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Theme.textPri)
                    Text(subtitle)
                        .font(Theme.Typography.caption())
                        .foregroundColor(Theme.textSec)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Theme.textSec)
            }
            .padding(.horizontal, 18)
            .padding(.vertical,   14)
            .background(hover ? Theme.surface2.opacity(0.7) : Theme.surface2.opacity(0.35))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(hover ? Theme.accent.opacity(0.6) : Theme.border1,
                            lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
