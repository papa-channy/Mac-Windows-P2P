// BrowserPane.swift — Send 화면 우측의 내장 파일 탐색기.
//
// 구성:
//   ┌─────────────────────────────────────────┐
//   │ 즐겨찾기 (Home / Desktop / Documents / …) │  ← 칩 row
//   │ 현재 경로: /Users/chan/Desktop           │  ← breadcrumb
//   ├─────────────────────────────────────────┤
//   │ ▸ Folder A                              │
//   │   file1.txt           18 KB             │  ← 클릭 = 큐에 추가
//   │ ▸ subdir/                               │  ← 더블클릭 = 진입
//   │ ...                                     │
//   └─────────────────────────────────────────┘
//
// onPick: 항목 단일클릭 시 호출 → SendViewModel.enqueue.
// 더블클릭 시 폴더면 내부로 진입, 파일이면 enqueue.

import SwiftUI
import TransferCore

struct BrowserPane: View {
    var onPick: ([URL]) -> Void

    @State private var currentRoot: URL = Self.defaultStart()
    @StateObject private var mindMap: MindMapModel = MindMapModel(rootURL: Self.defaultStart())
    @State private var hasFDA: Bool = FolderAccess.hasFullDiskAccess

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if hasFDA {
                FavoritesRow(currentDir: $currentRoot, onJump: { url in
                    setRoot(url)
                })
                Breadcrumb(url: currentRoot) { jumped in
                    setRoot(jumped)
                }
                MindMapView(
                    model: mindMap,
                    onSetRoot: { url in setRoot(url) },
                    onPick: { url in onPick([url]) }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                GrantPrompt(
                    onOpenSettings: openSettingsAndRefresh,
                    onRefresh: refreshGrantStatus,
                    onPickFolder: requestSingleFolderAccess
                )
            }
        }
        .padding(.horizontal, Theme.Layout.bodyPaddingH)
        .padding(.vertical,   Theme.Layout.bodyPaddingV)
        .onAppear {
            refreshGrantStatus()
        }
    }

    private func setRoot(_ url: URL) {
        currentRoot = url
        mindMap.setRoot(url)
    }

    private func refreshGrantStatus() {
        hasFDA = FolderAccess.hasFullDiskAccess
        if hasFDA {
            // FDA grant 후 첫 진입 — bookmark된 위치 또는 ~/로
            if let saved = FolderAccess.resolvedRoot(),
               saved != currentRoot
            {
                currentRoot = saved
                mindMap.setRoot(saved)
            }
        }
    }

    private func openSettingsAndRefresh() {
        FolderAccess.openFullDiskAccessSettings()
    }

    private func requestSingleFolderAccess() {
        guard let root = FolderAccess.requestGrant() else { return }
        currentRoot = root
        mindMap.setRoot(root)
    }

    private static func defaultStart() -> URL {
        if let saved = FolderAccess.resolvedRoot() {
            return saved
        }
        return URL(fileURLWithPath: NSHomeDirectory())
    }
}

// MARK: — Grant prompt

private struct GrantPrompt: View {
    var onOpenSettings: () -> Void   // 시스템 설정 → 전체 디스크 접근 (권장)
    var onRefresh: () -> Void         // 설정 후 사용자가 새로고침
    var onPickFolder: () -> Void      // NSOpenPanel 한 폴더만 (좁은 권한)

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .center, spacing: 10) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 36))
                    .foregroundColor(Theme.accent)
                Text("폴더 접근 권한이 필요합니다")
                    .font(Theme.Typography.title())
                    .foregroundColor(Theme.textPri)
                Text("매번 폴더마다 접근 권한을 묻지 않게 하려면 시스템 설정에서 한 번만 권한을 켜주세요.")
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity)

            // ─── 권장 흐름 (FDA) ───
            VStack(alignment: .leading, spacing: 8) {
                Text("권장 — 한 번에 모든 폴더 영구 허용")
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.accent)

                StepRow(num: 1, text: "아래 \"시스템 설정 열기\" 클릭 — 설정 패널 + Finder 창 동시에 열림")
                StepRow(num: 2, text: "Finder의 SendToWindows.app 아이콘을 FDA 목록으로 drag & drop\n(또는 + 버튼 → ~/Applications/SendToWindows.app 직접 선택)")
                StepRow(num: 3, text: "FDA 토글 ON 상태 확인 → 여기로 돌아와 \"새로고침\" 클릭")

                HStack(spacing: 8) {
                    Button(action: onOpenSettings) {
                        Text("시스템 설정 열기")
                            .font(Theme.Typography.body().weight(.semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(Theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }.buttonStyle(.plain)

                    Button(action: onRefresh) {
                        Text("새로고침")
                            .font(Theme.Typography.body())
                            .foregroundColor(Theme.textPri)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .stroke(Theme.border1, lineWidth: 1))
                    }.buttonStyle(.plain)
                }
                .padding(.top, 4)
            }
            .padding(12)
            .background(Theme.surface2.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            // ─── 대안 (좁은 권한) ───
            VStack(alignment: .leading, spacing: 6) {
                Text("대안 — 한 폴더만 임시 허용")
                    .font(Theme.Typography.caption())
                    .foregroundColor(Theme.textSec)
                Text("폴더 하나만 골라 그 안에서만 탐색. TCC 보호 폴더(Desktop/Documents/Downloads)는 추가 prompt 발생 가능.")
                    .font(.system(size: 10))
                    .foregroundColor(Theme.textSec.opacity(0.85))
                    .lineLimit(2)
                Button(action: onPickFolder) {
                    Text("한 폴더만 선택…")
                        .font(Theme.Typography.caption())
                        .foregroundColor(Theme.textPri)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .stroke(Theme.border1, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            .padding(12)
            .background(Theme.surface2.opacity(0.3))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct StepRow: View {
    let num: Int
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("\(num)")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 16, height: 16)
                .background(Theme.accent)
                .clipShape(Circle())
            Text(text)
                .font(Theme.Typography.caption())
                .foregroundColor(Theme.textPri)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: — 즐겨찾기

private struct FavoritesRow: View {
    @Binding var currentDir: URL
    var onJump: (URL) -> Void

    private struct Fav: Identifiable {
        let id = UUID()
        let emoji: String
        let name: String
        let url: URL
    }

    private var favorites: [Fav] {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let fm = FileManager.default
        return [
            Fav(emoji: "🏠", name: "홈",      url: home),
            Fav(emoji: "🖥", name: "데스크탑",
                url: fm.urls(for: .desktopDirectory,   in: .userDomainMask).first ?? home),
            Fav(emoji: "📄", name: "문서",
                url: fm.urls(for: .documentDirectory,  in: .userDomainMask).first ?? home),
            Fav(emoji: "⬇",  name: "다운로드",
                url: fm.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? home),
            Fav(emoji: "🛠", name: "Dev",     url: home.appendingPathComponent("Developer")),
        ]
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(favorites) { fav in
                    Chip(emoji: fav.emoji, label: fav.name,
                         active: fav.url.standardizedFileURL == currentDir.standardizedFileURL,
                         onTap: { onJump(fav.url) })
                }
            }
        }
    }
}

private struct Chip: View {
    let emoji: String
    let label: String
    let active: Bool
    var onTap: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                Text(emoji).font(.system(size: 12))
                Text(label).font(Theme.Typography.caption())
            }
            .foregroundColor(active ? .white : Theme.textPri)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(active ? Theme.accent : (hover ? Theme.surface2 : Theme.surface2.opacity(0.5)))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(Theme.border1, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// MARK: — Breadcrumb

private struct Breadcrumb: View {
    let url: URL
    var onJump: (URL) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                let parts = pathParts(url)
                ForEach(Array(parts.enumerated()), id: \.0) { idx, p in
                    Button(action: { onJump(p.url) }) {
                        Text(p.label)
                            .font(Theme.Typography.caption())
                            .foregroundColor(idx == parts.count - 1 ? Theme.textPri : Theme.textSec)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                    }
                    .buttonStyle(.plain)
                    if idx < parts.count - 1 {
                        Text("›").foregroundColor(Theme.textSec).font(.system(size: 11))
                    }
                }
            }
        }
        .frame(height: 18)
    }

    private struct Part { let label: String; let url: URL }
    private func pathParts(_ url: URL) -> [Part] {
        var u = url.standardizedFileURL
        var out: [Part] = []
        while u.path != "/" {
            let label = u.lastPathComponent.precomposedStringWithCanonicalMapping
            out.append(Part(label: label.isEmpty ? "/" : label, url: u))
            u = u.deletingLastPathComponent()
        }
        out.append(Part(label: "/", url: URL(fileURLWithPath: "/")))
        return out.reversed()
    }
}

// EntryList / EntryRow는 트리 구조로 대체됨 — FolderTree.swift 참조.
