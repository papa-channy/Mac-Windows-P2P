// MindMapView.swift — 진짜 마인드맵 시각화 (Canvas 곡선 + 인터랙티브 노드).
//
// 인터랙션:
//   - 빈 영역 드래그        = pan
//   - Pinch (혹은 Cmd+ / Cmd-) = zoom
//   - 노드 단일클릭         = expand/collapse
//   - 노드 더블클릭         = 이 폴더를 새 root
//   - 노드 드래그 (외부로)  = 큐에 추가 (NSItemProvider)
//   - 셰브론 버튼 클릭      = 단일클릭과 동일 (expand/collapse)
//
// 줌 범위: 0.3x ~ 2.5x.

import SwiftUI
import UniformTypeIdentifiers

struct MindMapView: View {
    @ObservedObject var model: MindMapModel
    var onSetRoot: (URL) -> Void
    var onPick: (URL) -> Void

    @State private var zoom: CGFloat = 1.0
    @State private var pan: CGSize = .zero          // 누적 pan
    @State private var dragPan: CGSize = .zero      // 진행 중인 drag delta
    @State private var dragZoom: CGFloat = 1.0      // 진행 중인 magnify delta

    private let zoomMin: CGFloat = 0.3
    private let zoomMax: CGFloat = 2.5

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // 배경 (pan/zoom 입력 받음)
                Theme.surface2.opacity(0.25)
                    .contentShape(Rectangle())
                    .gesture(panGesture)
                    .gesture(magnifyGesture)

                // 캔버스 + 노드 (zoom + pan 적용)
                MindMapCanvas(model: model,
                              onSetRoot: onSetRoot,
                              onPick: onPick)
                    .scaleEffect(zoom * dragZoom, anchor: .center)
                    .offset(x: pan.width + dragPan.width,
                            y: pan.height + dragPan.height)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.cardCorner,
                                        style: .continuous))
            .overlay(alignment: .topTrailing) {
                ZoomControls(zoom: $zoom, min: zoomMin, max: zoomMax,
                             onReset: { withAnimation { pan = .zero; zoom = 1.0 } })
                    .padding(8)
            }
        }
    }

    // MARK: — Gestures

    private var panGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { v in
                dragPan = CGSize(width: v.translation.width,
                                 height: v.translation.height)
            }
            .onEnded { v in
                pan.width  += v.translation.width
                pan.height += v.translation.height
                dragPan = .zero
            }
    }

    private var magnifyGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                dragZoom = value
            }
            .onEnded { value in
                let new = (zoom * value).clamped(to: zoomMin...zoomMax)
                zoom = new
                dragZoom = 1.0
            }
    }
}

// MARK: — 줌 컨트롤

private struct ZoomControls: View {
    @Binding var zoom: CGFloat
    let min: CGFloat
    let max: CGFloat
    var onReset: () -> Void

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Button("−") { zoom = (zoom - 0.1).clamped(to: min...max) }
                    .buttonStyle(.plain).frame(width: 22, height: 22)
                Text("\(Int(zoom * 100))%")
                    .font(Theme.Typography.caption())
                    .frame(width: 40)
                Button("+") { zoom = (zoom + 0.1).clamped(to: min...max) }
                    .buttonStyle(.plain).frame(width: 22, height: 22)
            }
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Theme.surfaceLow.opacity(0.85))
            .foregroundColor(Theme.textPri)
            .clipShape(Capsule())

            Button(action: onReset) {
                Text("⌂ 초기")
                    .font(.system(size: 10))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Theme.surfaceLow.opacity(0.85))
                    .foregroundColor(Theme.textSec)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: — Canvas (베지어 엣지 + 노드 overlay)

private struct MindMapCanvas: View {
    @ObservedObject var model: MindMapModel
    var onSetRoot: (URL) -> Void
    var onPick: (URL) -> Void

    var body: some View {
        // 매번 visible 수집 (혹은 layoutRevision 의존)
        let nodes = collectNodes()
        let edges = collectEdges()
        let bounds = model.canvasBounds()
        let padding: CGFloat = 60
        let canvasSize = CGSize(
            width:  bounds.width  + padding * 2,
            height: bounds.height + padding * 2
        )

        // 음수 좌표가 있을 수 있으니 origin 보정 offset
        let originAdjust = CGSize(
            width:  -bounds.minX + padding,
            height: -bounds.minY + padding
        )

        return ZStack(alignment: .topLeading) {
            // 곡선 엣지 — Canvas
            Canvas { ctx, _ in
                for (parent, child) in edges {
                    let p1 = CGPoint(
                        x: parent.position.x + model.nodeWidth / 2 + originAdjust.width,
                        y: parent.position.y + originAdjust.height
                    )
                    let p2 = CGPoint(
                        x: child.position.x - model.nodeWidth / 2 + originAdjust.width,
                        y: child.position.y + originAdjust.height
                    )
                    let midX = (p1.x + p2.x) / 2
                    var path = Path()
                    path.move(to: p1)
                    path.addCurve(to: p2,
                                  control1: CGPoint(x: midX, y: p1.y),
                                  control2: CGPoint(x: midX, y: p2.y))
                    ctx.stroke(path,
                               with: .color(Color(.sRGB, red: 0x33/255,
                                                  green: 0x33/255, blue: 0x3D/255)),
                               lineWidth: 1.4)
                }
            }
            .frame(width: canvasSize.width, height: canvasSize.height)

            // 노드 overlay
            ForEach(nodes) { node in
                MindMapNodeView(
                    node: node,
                    model: model,
                    onSetRoot: onSetRoot,
                    onPick: onPick
                )
                .frame(width: model.nodeWidth, height: model.nodeHeight)
                .position(x: node.position.x + originAdjust.width,
                          y: node.position.y + originAdjust.height)
            }
        }
        .frame(width: canvasSize.width, height: canvasSize.height)
        .id(model.layoutRevision)   // layout 바뀌면 강제 재구성
    }

    private func collectNodes() -> [MindMapModel.Node] {
        var out: [MindMapModel.Node] = []
        model.visibleNodes(into: &out)
        return out
    }
    private func collectEdges() -> [(MindMapModel.Node, MindMapModel.Node)] {
        var out: [(MindMapModel.Node, MindMapModel.Node)] = []
        model.visibleEdges(into: &out)
        return out
    }
}

// MARK: — 단일 노드

private struct MindMapNodeView: View {
    @ObservedObject var node: MindMapModel.Node
    let model: MindMapModel
    var onSetRoot: (URL) -> Void
    var onPick: (URL) -> Void

    @State private var hover = false

    var body: some View {
        HStack(spacing: 6) {
            // 셰브론 (폴더만)
            if node.isDirectory {
                Image(systemName: node.expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(Theme.textSec)
                    .frame(width: 14, height: 14)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        model.toggle(node)
                    }
            } else {
                Spacer().frame(width: 14)
            }

            Text(node.isDirectory ? "📁" : "📄")
                .font(.system(size: 13))

            Text(node.name)
                .font(Theme.Typography.body())
                .foregroundColor(Theme.textPri)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(hover ? Theme.surface2 : Theme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(hover ? Theme.accent.opacity(0.7) : Theme.border1, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onHover { hover = $0 }
        .onTapGesture(count: 2) {
            if node.isDirectory {
                onSetRoot(node.url)
            } else {
                onPick(node.url)
            }
        }
        .onTapGesture(count: 1) {
            if node.isDirectory {
                model.toggle(node)
            } else {
                onPick(node.url)
            }
        }
        .onDrag {
            NSItemProvider(contentsOf: node.url)
                ?? NSItemProvider(object: node.url as NSURL)
        }
    }
}

// MARK: — 유틸

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
