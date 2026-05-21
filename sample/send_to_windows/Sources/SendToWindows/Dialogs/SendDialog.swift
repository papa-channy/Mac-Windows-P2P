// SendDialog.swift — §2~3 사양에 따른 송신 다이얼로그.
//
// 입력: 보낼 항목 1개 (Phase 2 우클릭 진입). Phase 3에서 다중 모드 추가.
// 출력: onCancel() / onSend(category) 클로저.
// 호스팅: AppKit borderless window (App.swift에서 chrome 셋업).

import SwiftUI
import TransferCore

public struct SendDialog: View {
    public let item: URL
    public let isDirectory: Bool
    public let sizeBytes: Int64

    public var onCancel: () -> Void
    public var onSend: (TransferCategory) -> Void

    @State private var category: TransferCategory = Categories.default

    public init(item: URL,
                isDirectory: Bool,
                sizeBytes: Int64,
                onCancel: @escaping () -> Void,
                onSend: @escaping (TransferCategory) -> Void) {
        self.item = item
        self.isDirectory = isDirectory
        self.sizeBytes = sizeBytes
        self.onCancel = onCancel
        self.onSend = onSend
    }

    public var body: some View {
        VStack(spacing: 0) {
            HeaderBar(title: "Windows로 보내기", onClose: onCancel)
            content
            FooterBar(
                primaryLabel: "Windows로 전송",
                onCancel: onCancel,
                onConfirm: { onSend(category) }
            )
        }
        .frame(width: Theme.Layout.dialogWidth)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.outerCorner,
                                    style: .continuous))
        // ESC=취소, Enter=전송 (강조 버튼 default)
        .background(KeyHandler(
            onEscape: onCancel,
            onReturn: { onSend(category) }
        ))
        .preferredColorScheme(.dark)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 18) {
            Section(label: "전송 대상") {
                ItemCard(url: item, isDirectory: isDirectory, sizeBytes: sizeBytes)
            }
            Section(label: "카테고리") {
                CategoryPicker(selection: $category)
            }
        }
        .padding(.horizontal, Theme.Layout.bodyPaddingH)
        .padding(.vertical,   Theme.Layout.bodyPaddingV)
    }
}

// MARK: — 공통 컴포넌트

struct HeaderBar: View {
    let title: String
    var onClose: () -> Void

    var body: some View {
        ZStack {
            // 가장 뒤: 드래그 + 배경색을 함께 그리는 NSView.
            // SwiftUI Color를 여기 두면 mouseDown을 가로채서 드래그가 죽음.
            DraggableHeaderBackground()
            HStack(spacing: 10) {
                // logo placeholder (24×24)
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(Theme.accent.opacity(0.85))
                    .frame(width: 24, height: 24)
                    .overlay(
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.white)
                    )
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

struct FooterBar: View {
    let primaryLabel: String
    var onCancel: (() -> Void)?
    var onConfirm: () -> Void

    @Environment(\.dangerPrimary) private var dangerPrimary

    var body: some View {
        ZStack {
            Theme.surfaceLow
            HStack(spacing: 10) {
                Spacer()
                if let onCancel {
                    GhostButton("취소", action: onCancel)
                }
                AccentButton(primaryLabel, danger: dangerPrimary, action: onConfirm)
            }
            .padding(.horizontal, Theme.Layout.bodyPaddingH)
        }
        .frame(height: Theme.Layout.footerHeight)
    }
}

struct Section<Content: View>: View {
    let label: String
    let content: () -> Content
    init(label: String, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(Theme.Typography.caption())
                .foregroundColor(Theme.textSec)
            content()
        }
    }
}

struct ItemCard: View {
    let url: URL
    let isDirectory: Bool
    let sizeBytes: Int64

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(isDirectory ? "📁" : "📄")
                .font(.system(size: 22))
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(url.lastPathComponent.precomposedStringWithCanonicalMapping)
                    .font(Theme.Typography.body())
                    .foregroundColor(Theme.textPri)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(humanSize(sizeBytes))  ·  \(parentPath)")
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
        }
        .padding(.horizontal, Theme.Layout.cardPaddingH)
        .padding(.vertical,   Theme.Layout.cardPaddingV)
        .background(Theme.surface2)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Layout.cardCorner, style: .continuous)
                .stroke(Theme.border1, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.cardCorner, style: .continuous))
    }

    private var parentPath: String {
        url.deletingLastPathComponent().path
    }

    private func humanSize(_ n: Int64) -> String {
        let f = ByteCountFormatter()
        f.allowedUnits = [.useBytes, .useKB, .useMB, .useGB, .useTB]
        f.countStyle = .file
        return f.string(fromByteCount: n)
    }
}

struct CategoryPicker: View {
    @Binding var selection: TransferCategory

    var body: some View {
        Menu {
            ForEach(Categories.all) { cat in
                Button(action: { selection = cat }) {
                    Text("\(cat.emoji)   \(cat.label)")
                }
            }
        } label: {
            HStack {
                Text("\(selection.emoji)   \(selection.label)")
                    .font(Theme.Typography.body())
                    .foregroundColor(Theme.textPri)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(Theme.textSec)
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
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
    }
}

struct CloseButton: View {
    var onTap: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: onTap) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(hover ? .white : Theme.textSec)
                .frame(width: 26, height: 26)
                .background(hover ? Theme.danger : Color.clear)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct AccentButton: View {
    let label: String
    let danger: Bool
    var action: () -> Void
    @State private var hover = false

    init(_ label: String, danger: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.danger = danger
        self.action = action
    }

    private var baseColor: Color {
        danger ? Theme.danger : Theme.accent
    }
    private var hoverColor: Color {
        // 빨강에 hover variant 없음 — 살짝 밝게
        danger ? Theme.danger.opacity(0.85) : Theme.accentHi
    }

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(Theme.Typography.body().weight(.semibold))
                .foregroundColor(.white)
                .padding(.horizontal, Theme.Layout.buttonPaddingH)
                .padding(.vertical,   Theme.Layout.buttonPaddingV)
                .background(hover ? hoverColor : baseColor)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.buttonCorner,
                                            style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .keyboardShortcut(.defaultAction)
    }
}

struct GhostButton: View {
    let label: String
    var action: () -> Void
    @State private var hover = false

    init(_ label: String, action: @escaping () -> Void) {
        self.label = label
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(Theme.Typography.body())
                .foregroundColor(Theme.textPri)
                .padding(.horizontal, Theme.Layout.buttonPaddingH)
                .padding(.vertical,   Theme.Layout.buttonPaddingV)
                .background(hover ? Theme.surface2 : Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Layout.buttonCorner,
                                     style: .continuous)
                        .stroke(Theme.border1, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.buttonCorner,
                                            style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .keyboardShortcut(.cancelAction)
    }
}

// MARK: — AppKit 브릿지

/// 헤더 영역의 NSWindow 드래그 트래킹 + 옵션 배경색.
///
/// 두 가지 안전망:
/// 1. `mouseDownCanMoveWindow = true` — AppKit이 hit view chain 따라 자동 드래그 발동.
/// 2. `mouseDown(with:)` 백업 — flag 무시되는 케이스 대비.
///
/// **중요**: SwiftUI `Color`는 hit-test를 가로채므로 헤더 ZStack 안에 별도 Color
/// 두면 안 됨. 배경색이 필요하면 반드시 이 view 한 곳에서 그릴 것.
struct WindowDragArea: NSViewRepresentable {
    let backgroundColor: NSColor?

    init(backgroundColor: NSColor? = nil) {
        self.backgroundColor = backgroundColor
    }

    final class DragView: NSView {
        var bgColor: NSColor?
        override var mouseDownCanMoveWindow: Bool { true }
        override func mouseDown(with event: NSEvent) {
            window?.performDrag(with: event)
        }
        override func draw(_ dirtyRect: NSRect) {
            if let bg = bgColor {
                bg.setFill()
                dirtyRect.fill()
            }
            super.draw(dirtyRect)
        }
    }

    func makeNSView(context: Context) -> NSView {
        let v = DragView()
        v.bgColor = backgroundColor
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        (nsView as? DragView)?.bgColor = backgroundColor
        nsView.needsDisplay = true
    }
}

/// Theme.surfaceLow 색으로 채워진 드래그 영역. 헤더 ZStack 최하단에 둘 것.
struct DraggableHeaderBackground: View {
    var body: some View {
        WindowDragArea(backgroundColor: Theme.NS.surfaceLow)
    }
}

/// ESC/Return 키 핸들러 — SwiftUI keyboardShortcut만으로 못 잡는 경우 대비.
struct KeyHandler: NSViewRepresentable {
    var onEscape: () -> Void
    var onReturn: () -> Void

    final class HandlerView: NSView {
        var onEscape: (() -> Void)?
        var onReturn: (() -> Void)?
        override var acceptsFirstResponder: Bool { true }
        override func keyDown(with event: NSEvent) {
            switch event.keyCode {
            case 53: onEscape?()                // ESC
            case 36, 76: onReturn?()            // Return / numpad Enter
            default: super.keyDown(with: event)
            }
        }
    }

    func makeNSView(context: Context) -> NSView {
        let v = HandlerView()
        v.onEscape = onEscape
        v.onReturn = onReturn
        DispatchQueue.main.async { v.window?.makeFirstResponder(v) }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        guard let v = nsView as? HandlerView else { return }
        v.onEscape = onEscape
        v.onReturn = onReturn
    }
}
