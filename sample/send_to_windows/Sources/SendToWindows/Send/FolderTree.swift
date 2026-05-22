// FolderTree.swift — 우측 파일 탐색기를 트리 구조로.
//
// 정책:
//   - 사전 walk 깊이 = 3 (root=0, 1, 2 레벨까지 펼침). 그 이하는 사용자가
//     더블클릭으로 root를 옮겨서 탐색.
//   - 한 폴더당 entries 200개 cap (대형 디렉터리 진입 시 UI 폭주 방지).
//   - 정렬: 폴더 우선 → 그 안에서 case-insensitive 이름순.
//   - 숨김 파일 skip.
//
// UX:
//   - 폴더 행: 셰브론으로 펼치기/접기 / 행 단일클릭 = 펼치기 toggle /
//             더블클릭 = 이 폴더를 새 root로 / 드래그 = 큐에 추가
//   - 파일 행: 단일클릭 = 큐에 추가 / 드래그 = 큐에 추가 / 더블클릭 = 큐에 추가

import SwiftUI
import UniformTypeIdentifiers

struct FileNode: Identifiable, Hashable {
    let id: URL                  // = url, Identifiable 키
    let url: URL
    let name: String             // NFC display name
    let isDirectory: Bool
    let sizeBytes: Int64
    var children: [FileNode]?    // nil = leaf, [] = empty folder, [...] = folder with kids
    var readError: String?       // contentsOfDirectory 실패 시 사람용 메시지

    init(url: URL, isDirectory: Bool, sizeBytes: Int64,
         children: [FileNode]?, readError: String? = nil) {
        self.id = url.standardizedFileURL
        self.url = url
        self.name = url.lastPathComponent.precomposedStringWithCanonicalMapping
        self.isDirectory = isDirectory
        self.sizeBytes = sizeBytes
        self.children = children
        self.readError = readError
    }
}

enum FolderTreeBuilder {

    static let defaultMaxDepth = 3
    static let entriesCapPerFolder = 200

    /// rootURL부터 walk. depthLeft 0 도달 시 더 이상 children 채우지 않음
    /// (해당 폴더는 빈 children로 표시 — 사용자가 root 옮기면 그 안 트리 다시 build).
    static func build(rootURL: URL,
                      depthLeft: Int = defaultMaxDepth) -> FileNode {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey]

        let isDir = ((try? rootURL.resourceValues(forKeys: [.isDirectoryKey]))?
            .isDirectory) ?? true
        // root는 폴더라고 가정 — file이면 leaf로 그냥 반환
        guard isDir else {
            let size = Int64((try? rootURL.resourceValues(forKeys: [.fileSizeKey]))?
                .fileSize ?? 0)
            return FileNode(url: rootURL, isDirectory: false,
                            sizeBytes: size, children: nil)
        }

        var children: [FileNode] = []
        var readError: String?
        if depthLeft > 0 {
            let entries: [URL]
            do {
                entries = try fm.contentsOfDirectory(
                    at: rootURL,
                    includingPropertiesForKeys: keys,
                    options: [.skipsHiddenFiles]
                )
            } catch {
                entries = []
                let ns = error as NSError
                readError = "[code \(ns.code)] \(ns.localizedDescription)"
            }

            // 정렬: 폴더 우선 → 이름순
            let sorted = entries.sorted { a, b in
                let aDir = ((try? a.resourceValues(forKeys: [.isDirectoryKey]))?
                    .isDirectory) ?? false
                let bDir = ((try? b.resourceValues(forKeys: [.isDirectoryKey]))?
                    .isDirectory) ?? false
                if aDir != bDir { return aDir }
                return a.lastPathComponent
                    .localizedCaseInsensitiveCompare(b.lastPathComponent)
                    == .orderedAscending
            }

            let capped = sorted.prefix(entriesCapPerFolder)
            for url in capped {
                let rv = try? url.resourceValues(forKeys: Set(keys))
                let isSubDir = rv?.isDirectory ?? false
                let size = Int64(rv?.fileSize ?? 0)
                if isSubDir {
                    let sub = build(rootURL: url, depthLeft: depthLeft - 1)
                    children.append(sub)
                } else {
                    children.append(FileNode(
                        url: url, isDirectory: false,
                        sizeBytes: size, children: nil))
                }
            }
        }

        return FileNode(url: rootURL, isDirectory: true, sizeBytes: 0,
                        children: children, readError: readError)
    }
}

// MARK: — 트리 뷰

struct FolderTreeView: View {
    let root: FileNode
    var onSetRoot: (URL) -> Void
    var onPick: (URL) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let err = root.readError {
                    Text("⚠️ 폴더 읽기 실패: \(err)")
                        .font(Theme.Typography.caption())
                        .foregroundColor(Theme.danger)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                }
                ForEach(root.children ?? []) { child in
                    NodeRow(node: child, depth: 0,
                            onSetRoot: onSetRoot, onPick: onPick)
                }
                if (root.children ?? []).isEmpty, root.readError == nil {
                    Text("(비어 있음 — \(root.url.path))")
                        .font(Theme.Typography.caption())
                        .foregroundColor(Theme.textSec)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                }
            }
            .padding(.vertical, 4)
        }
        .background(Theme.surface2.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Layout.cardCorner,
                                    style: .continuous))
    }
}

private struct NodeRow: View {
    let node: FileNode
    let depth: Int
    var onSetRoot: (URL) -> Void
    var onPick: (URL) -> Void

    @State private var expanded: Bool = false

    private let rowHeight: CGFloat = 24
    private let indentStep: CGFloat = 14

    var body: some View {
        VStack(spacing: 0) {
            // 본 행
            HStack(spacing: 4) {
                // 들여쓰기
                Spacer().frame(width: CGFloat(depth) * indentStep)

                // 셰브론 (폴더만)
                if node.isDirectory {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(Theme.textSec)
                        .frame(width: 12, height: rowHeight)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            // 셰브론만 누르면 펼치기만, 아무것도 enqueue 안 함
                            expanded.toggle()
                        }
                } else {
                    Spacer().frame(width: 12, height: rowHeight)
                }

                // 아이콘 + 이름 + (파일이면) 크기
                Text(node.isDirectory ? "📁" : "📄")
                    .font(.system(size: 12))
                    .frame(width: 18)
                Text(node.name)
                    .font(Theme.Typography.body())
                    .foregroundColor(Theme.textPri)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                if !node.isDirectory {
                    Text(humanSize(node.sizeBytes))
                        .font(Theme.Typography.caption())
                        .foregroundColor(Theme.textSec)
                }
            }
            .frame(height: rowHeight)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
            // 더블클릭이 단일클릭보다 우선 (둘 다 등록할 때 SwiftUI 순서 중요)
            .onTapGesture(count: 2) {
                if node.isDirectory {
                    onSetRoot(node.url)
                } else {
                    onPick(node.url)
                }
            }
            .onTapGesture(count: 1) {
                if node.isDirectory {
                    expanded.toggle()
                } else {
                    onPick(node.url)
                }
            }
            // 드래그 = NSItemProvider로 file URL 제공 → 좌측 DropArea가 [.fileURL]로 받음
            .onDrag {
                NSItemProvider(contentsOf: node.url)
                    ?? NSItemProvider(object: node.url as NSURL)
            }

            // 펼친 폴더의 자식들
            if node.isDirectory, expanded {
                ForEach(node.children ?? []) { child in
                    NodeRow(node: child, depth: depth + 1,
                            onSetRoot: onSetRoot, onPick: onPick)
                }
                if (node.children ?? []).isEmpty {
                    HStack {
                        Spacer().frame(width: CGFloat(depth + 1) * indentStep + 30)
                        Text("(비어 있음 — 더블클릭으로 더 깊이 탐색)")
                            .font(Theme.Typography.caption())
                            .foregroundColor(Theme.textSec.opacity(0.7))
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func humanSize(_ n: Int64) -> String {
        let f = ByteCountFormatter()
        f.allowedUnits = [.useBytes, .useKB, .useMB, .useGB, .useTB]
        f.countStyle = .file
        return f.string(fromByteCount: n)
    }
}
