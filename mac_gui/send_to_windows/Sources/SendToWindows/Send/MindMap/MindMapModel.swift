// MindMapModel.swift — 파일 시스템 트리의 마인드맵 시각화 모델.
//
// 핵심:
//   - lazy load: root + level 1만 사전 로드. 폴더 펼치면 그때 자식 enumerate.
//   - layout: subtree 높이 기반 vertical stacking (horizontal Reingold-Tilford 변형).
//   - 노드별 expand 상태 보존 (root 안 바뀌면 펼친 상태 유지).

import Foundation
import SwiftUI

@MainActor
final class MindMapModel: ObservableObject {

    // MARK: — Tuning

    let nodeWidth: CGFloat   = 180
    let nodeHeight: CGFloat  = 34
    let xSpacing: CGFloat    = 80       // 부모-자식 horizontal 간격 (중심 사이)
    let yGap: CGFloat        = 10       // 형제 vertical 간격
    let entriesCap           = 200      // 한 폴더당 자식 수 cap (UI 폭주 방지)

    // MARK: — 노드

    final class Node: Identifiable, ObservableObject {
        let id = UUID()
        let url: URL
        let name: String
        let isDirectory: Bool
        let sizeBytes: Int64
        var children: [Node]? = nil     // nil = 미로드 / [] = 빈 폴더 / [..] = 로드됨
        @Published var expanded: Bool = false
        var readError: String? = nil

        // Layout 계산 결과 (model.layout() 후 채워짐)
        var position: CGPoint = .zero   // 중심점
        var subtreeHeight: CGFloat = 0  // 자기+자손 차지 vertical 공간

        init(url: URL, isDir: Bool, size: Int64) {
            self.url = url
            self.name = url.lastPathComponent.precomposedStringWithCanonicalMapping
            self.isDirectory = isDir
            self.sizeBytes = size
        }
    }

    @Published var root: Node
    @Published private(set) var layoutRevision: Int = 0   // SwiftUI 재렌더 트리거

    init(rootURL: URL) {
        self.root = Self.makeNode(at: rootURL)
        loadChildren(of: root)            // root 자식들 한 번 로드
        root.expanded = true              // root는 기본 펼침
        for c in root.children ?? [] where c.isDirectory {
            loadChildren(of: c)            // level 1 자식들의 children도 미리 로드
        }                                  // (마인드맵에 초기 가지 한 단계 더 보이게)
        layout()
    }

    // MARK: — root 변경 (탐색)

    func setRoot(_ url: URL) {
        let n = Self.makeNode(at: url)
        loadChildren(of: n)
        n.expanded = true
        for c in n.children ?? [] where c.isDirectory {
            loadChildren(of: c)
        }
        root = n
        layout()
    }

    // MARK: — expand/collapse (lazy load)

    func toggle(_ node: Node) {
        if node.children == nil {
            loadChildren(of: node)
        }
        node.expanded.toggle()
        layout()
    }

    // MARK: — Layout

    func layout() {
        _ = computeSubtreeHeight(node: root)
        placeNode(node: root, centerX: nodeWidth / 2, centerY: 0)
        // Y 좌표 음수 가능 — view 단에서 offset.
        layoutRevision += 1
    }

    /// 모든 visible 노드 순회 (rendering용).
    func visibleNodes(into out: inout [Node]) {
        traverseVisible(node: root) { out.append($0) }
    }

    /// 모든 visible edge (parent, child) 쌍.
    func visibleEdges(into out: inout [(Node, Node)]) {
        traverseVisible(node: root) { n in
            if n.expanded, let kids = n.children {
                for k in kids { out.append((n, k)) }
            }
        }
    }

    /// 전체 canvas bounds (모든 visible 노드를 감싸는 사각형).
    func canvasBounds() -> CGRect {
        var minX: CGFloat =  .infinity
        var minY: CGFloat =  .infinity
        var maxX: CGFloat = -.infinity
        var maxY: CGFloat = -.infinity
        var nodes: [Node] = []
        visibleNodes(into: &nodes)
        for n in nodes {
            minX = min(minX, n.position.x - nodeWidth / 2)
            maxX = max(maxX, n.position.x + nodeWidth / 2)
            minY = min(minY, n.position.y - nodeHeight / 2)
            maxY = max(maxY, n.position.y + nodeHeight / 2)
        }
        if !nodes.isEmpty {
            return CGRect(x: minX, y: minY,
                          width: maxX - minX, height: maxY - minY)
        }
        return .zero
    }

    // MARK: — Internal

    private static func makeNode(at url: URL) -> Node {
        let rv = try? url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
        let isDir = rv?.isDirectory ?? true
        let size = Int64(rv?.fileSize ?? 0)
        return Node(url: url, isDir: isDir, size: size)
    }

    private func loadChildren(of node: Node) {
        guard node.isDirectory else {
            node.children = nil
            return
        }
        let fm = FileManager.default
        do {
            let entries = try fm.contentsOfDirectory(
                at: node.url,
                includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
                options: [.skipsHiddenFiles]
            )
            let sorted = entries.sorted { a, b in
                let aDir = ((try? a.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory) ?? false
                let bDir = ((try? b.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory) ?? false
                if aDir != bDir { return aDir }   // 폴더 먼저
                return a.lastPathComponent
                    .localizedCaseInsensitiveCompare(b.lastPathComponent)
                    == .orderedAscending
            }
            let capped = sorted.prefix(entriesCap)
            node.children = capped.map { Self.makeNode(at: $0) }
            node.readError = nil
        } catch {
            node.children = []
            let ns = error as NSError
            node.readError = "[code \(ns.code)] \(ns.localizedDescription)"
        }
    }

    /// subtree 높이 = 자기 nodeHeight (collapsed/leaf), 또는 자식 합 + gap (expanded).
    @discardableResult
    private func computeSubtreeHeight(node: Node) -> CGFloat {
        if !node.expanded || node.children == nil || node.children!.isEmpty {
            node.subtreeHeight = nodeHeight
            return nodeHeight
        }
        var total: CGFloat = 0
        for (i, c) in node.children!.enumerated() {
            total += computeSubtreeHeight(node: c)
            if i < node.children!.count - 1 { total += yGap }
        }
        node.subtreeHeight = max(total, nodeHeight)
        return node.subtreeHeight
    }

    /// 노드를 (centerX, centerY)에 두고 자식들 placement 재귀.
    private func placeNode(node: Node, centerX: CGFloat, centerY: CGFloat) {
        node.position = CGPoint(x: centerX, y: centerY)
        guard node.expanded, let kids = node.children, !kids.isEmpty else { return }

        // 자식들이 차지하는 총 높이
        var total: CGFloat = 0
        for (i, c) in kids.enumerated() {
            total += c.subtreeHeight
            if i < kids.count - 1 { total += yGap }
        }

        // 자식들의 첫 시작 y (=top)
        var y = centerY - total / 2
        let childX = centerX + xSpacing
        for c in kids {
            let childCenterY = y + c.subtreeHeight / 2
            placeNode(node: c, centerX: childX, centerY: childCenterY)
            y += c.subtreeHeight + yGap
        }
    }

    /// expanded chain만 따라 traverse.
    private func traverseVisible(node: Node, _ visit: (Node) -> Void) {
        visit(node)
        if node.expanded, let kids = node.children {
            for c in kids { traverseVisible(node: c, visit) }
        }
    }
}
