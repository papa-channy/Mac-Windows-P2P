// SendView.swift — 이분할 화면.
//
//   ┌────────────────────────────────────────────────────────────────┐
//   │  Header (← 뒤로 + 제목 + 닫기)                                  │
//   ├──────────────────────────────┬─────────────────────────────────┤
//   │  Queue Pane                  │  Browser Pane                   │
//   │  (Drag&Drop 영역 + 파일 목록)│  (내장 파일 탐색기)             │
//   │  + 카테고리 picker            │                                 │
//   │  + 전송 버튼                  │                                 │
//   └──────────────────────────────┴─────────────────────────────────┘

import SwiftUI
import UniformTypeIdentifiers
import TransferCore

public struct SendView: View {
    @StateObject private var vm = SendViewModel()
    public var onBack: () -> Void
    public var onQuit: () -> Void

    public init(onBack: @escaping () -> Void, onQuit: @escaping () -> Void) {
        self.onBack = onBack
        self.onQuit = onQuit
    }

    public var body: some View {
        VStack(spacing: 0) {
            SecondaryHeader(title: "파일 보내기", onBack: onBack, onClose: onQuit)
            HStack(spacing: 0) {
                QueuePane(vm: vm)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider().background(Theme.border1)
                BrowserPane(onPick: { vm.enqueue(urls: $0) })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 920, minHeight: 540)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.outerCorner,
                                    style: .continuous))
        .preferredColorScheme(.dark)
        .overlay(alignment: .top) {
            if vm.isSending {
                BannerOverlay(text: "전송 중…", color: Theme.accent)
            } else if let err = vm.lastError {
                BannerOverlay(text: err, color: Theme.danger)
                    .onTapGesture { vm.lastError = nil }
            } else if let out = vm.lastOutcome {
                BannerOverlay(
                    text: "✓ 전송 완료 — \(out.items.count)개 항목",
                    color: Theme.success
                )
                .onTapGesture { vm.lastOutcome = nil }
            }
        }
    }
}

// MARK: — Secondary header (Home과 구분, 뒤로 가기 버튼 포함)

struct SecondaryHeader: View {
    let title: String
    var onBack: () -> Void
    var onClose: () -> Void

    var body: some View {
        ZStack {
            DraggableHeaderBackground()
            HStack(spacing: 10) {
                Button(action: onBack) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 11, weight: .semibold))
                        Text("홈")
                    }
                    .font(Theme.Typography.body())
                    .foregroundColor(Theme.textSec)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Spacer()
                Text(title)
                    .font(Theme.Typography.title())
                    .foregroundColor(Theme.textPri)
                Spacer()
                CloseButton(onTap: onClose)
            }
            .padding(.horizontal, Theme.Layout.bodyPaddingH)
        }
        .frame(height: Theme.Layout.headerHeight)
    }
}

// MARK: — Queue 패널 (좌측)

struct QueuePane: View {
    @ObservedObject var vm: SendViewModel
    @State private var isTargeted: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Section(label: "전송 큐 (\(vm.queue.count)개)") {
                DropArea(isTargeted: $isTargeted, vm: vm)
            }
            CategoryRow(vm: vm)
            SendActionRow(vm: vm)
        }
        .padding(.horizontal, Theme.Layout.bodyPaddingH)
        .padding(.vertical,   Theme.Layout.bodyPaddingV)
    }
}

private struct DropArea: View {
    @Binding var isTargeted: Bool
    @ObservedObject var vm: SendViewModel

    var body: some View {
        VStack(spacing: 0) {
            if vm.queue.isEmpty {
                EmptyDropPlaceholder(isTargeted: isTargeted)
            } else {
                QueueList(vm: vm)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(isTargeted
                    ? Theme.accent.opacity(0.12)
                    : Theme.surface2.opacity(0.35))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Layout.cardCorner, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                .foregroundColor(isTargeted ? Theme.accent : Theme.border1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.cardCorner,
                                    style: .continuous))
        .onDrop(of: [UTType.fileURL], isTargeted: $isTargeted) { providers in
            handleDrop(providers)
        }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        var any = false
        for provider in providers {
            guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
            else { continue }
            any = true
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) {
                item, _ in
                var url: URL?
                if let d = item as? Data { url = URL(dataRepresentation: d, relativeTo: nil) }
                else if let s = item as? String { url = URL(string: s) }
                else if let u = item as? URL { url = u }
                guard let u = url else { return }
                Task { @MainActor in vm.enqueue(urls: [u]) }
            }
        }
        return any
    }
}

private struct EmptyDropPlaceholder: View {
    let isTargeted: Bool
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray.and.arrow.down.fill")
                .font(.system(size: 42))
                .foregroundColor(isTargeted ? Theme.accent : Theme.textSec)
            Text("파일/폴더를 여기로 끌어다 놓기")
                .font(Theme.Typography.body())
                .foregroundColor(Theme.textPri)
            Text("Finder · ForkLift · 우측 탐색기 모두 가능")
                .font(Theme.Typography.caption())
                .foregroundColor(Theme.textSec)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct QueueList: View {
    @ObservedObject var vm: SendViewModel
    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(vm.queue) { item in
                    QueueRow(item: item, onRemove: { vm.remove(item) })
                }
            }
            .padding(8)
        }
    }
}

private struct QueueRow: View {
    let item: SendViewModel.QueueItem
    var onRemove: () -> Void
    @State private var hover = false

    var body: some View {
        HStack(spacing: 10) {
            Text(item.isDirectory ? "📁" : "📄")
                .font(.system(size: 18))
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.url.lastPathComponent.precomposedStringWithCanonicalMapping)
                    .font(Theme.Typography.body())
                    .foregroundColor(Theme.textPri)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(humanSize(item.sizeBytes))
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
            }
            Spacer()
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundColor(hover ? Theme.danger : Theme.textSec)
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.surface2.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func humanSize(_ n: Int64) -> String {
        let f = ByteCountFormatter()
        f.allowedUnits = [.useBytes, .useKB, .useMB, .useGB, .useTB]
        f.countStyle = .file
        return f.string(fromByteCount: n)
    }
}

// MARK: — Category + 전송 행

private struct CategoryRow: View {
    @ObservedObject var vm: SendViewModel
    var body: some View {
        Section(label: "카테고리 (모든 항목 공통)") {
            CategoryPicker(selection: $vm.category)
            Text("기본은 미분류. 다중 전송 시 LLM 자동 분류는 향후 도입.")
                .font(Theme.Typography.caption())
                .foregroundColor(Theme.textSec)
        }
    }
}

private struct SendActionRow: View {
    @ObservedObject var vm: SendViewModel
    var body: some View {
        HStack {
            if !vm.queue.isEmpty {
                Button("큐 비우기") { vm.clear() }
                    .buttonStyle(.plain)
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
            }
            Spacer()
            AccentButton(vm.queue.isEmpty ? "항목 없음" : "Windows로 전송",
                         danger: false) {
                Task { await vm.send() }
            }
            .disabled(vm.queue.isEmpty || vm.isSending)
            .opacity(vm.queue.isEmpty || vm.isSending ? 0.5 : 1)
        }
    }
}

// MARK: — Banner overlay

private struct BannerOverlay: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(Theme.Typography.body().weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(color)
            .clipShape(Capsule())
            .padding(.top, Theme.Layout.headerHeight + 8)
            .shadow(color: .black.opacity(0.4), radius: 6, y: 2)
    }
}
