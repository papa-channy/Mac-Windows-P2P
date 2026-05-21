// SentView.swift — Phase 5 자리.
// 결정 #10: ~/Library/Logs/MacWindowShare/sent.jsonl 로컬 로그를 트리/리스트로 표시.
// 셰어 파일이 없어져도 로그 라인은 그대로 보임.

import SwiftUI
import TransferCore

public struct SentView: View {
    public var onBack: () -> Void
    public var onQuit: () -> Void

    @State private var entries: [SentHistoryEntry] = []
    @State private var error: String?

    public init(onBack: @escaping () -> Void, onQuit: @escaping () -> Void) {
        self.onBack = onBack
        self.onQuit = onQuit
    }

    public var body: some View {
        VStack(spacing: 0) {
            SecondaryHeader(title: "보낸 파일 기록", onBack: onBack, onClose: onQuit)
            content
        }
        .frame(minWidth: 720, minHeight: 460)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.outerCorner,
                                    style: .continuous))
        .preferredColorScheme(.dark)
        .onAppear(perform: reload)
    }

    @ViewBuilder private var content: some View {
        if let error {
            VStack(spacing: 8) {
                Text("로그 읽기 실패").font(Theme.Typography.title())
                Text(error).font(Theme.Typography.caption()).foregroundColor(Theme.textSec)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if entries.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "doc.text").font(.system(size: 48))
                    .foregroundColor(Theme.textSec)
                Text("아직 송신 기록이 없습니다")
                    .font(Theme.Typography.title())
                    .foregroundColor(Theme.textPri)
                Text("우클릭이나 Send 화면으로 파일을 보내면 여기 쌓입니다.")
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(entries.reversed()) { entry in
                        SentRow(entry: entry)
                    }
                }
                .padding(Theme.Layout.bodyPaddingH)
            }
        }
    }

    private func reload() {
        do {
            entries = try SentHistory.readAll()
        } catch {
            self.error = "\(error)"
        }
    }
}

private struct SentRow: View {
    let entry: SentHistoryEntry

    private var cat: TransferCategory? { Categories.byKey(entry.category) }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(cat?.emoji ?? "📦")
                .font(.system(size: 20))
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.primary_name)
                    .font(Theme.Typography.body())
                    .foregroundColor(Theme.textPri)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(entry.created_at)  ·  \(cat?.label ?? entry.category)  ·  \(humanSize(entry.bytes))  ·  \(entry.item_count)개")
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
            }
            Spacer()
            Text(entry.mode)
                .font(Theme.Typography.caption())
                .foregroundColor(Theme.textSec)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Theme.surface2)
                .clipShape(Capsule())
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.surface2.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func humanSize(_ n: Int64) -> String {
        let f = ByteCountFormatter()
        f.allowedUnits = [.useBytes, .useKB, .useMB, .useGB, .useTB]
        f.countStyle = .file
        return f.string(fromByteCount: n)
    }
}
