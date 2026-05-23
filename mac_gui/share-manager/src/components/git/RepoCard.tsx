// RepoCard — one row in the L1 dashboard's "Repo Card grid". Aggregates
// every host's per-repo status into a single card with badge + 3-node
// bridge + optional conflict banner. Mirror of windows_gui/.../app.js
// renderGitL1Card + gitRepoSummary.
//
// Clicking the card is meant to open the L2 detail modal — that lands in
// Wave C step 2 (T1.5). For now the click is a noop hook the consumer
// can wire.

import type { RepoStatus, RemoteRepoState } from "../../lib/api";
import { ThreeNodeBridge } from "./ThreeNodeBridge";

export type RepoCardKind =
  | "synced"
  | "diverged"
  | "dirty"
  | "conflict"
  | "partial";

export interface RepoCardSummary {
  ownerRepo: string | null;
  label: string;
  /** every host's status indexed by host name */
  byHost: Record<string, RepoStatus & { os: string }>;
  remote: RemoteRepoState | null;
}

interface Props {
  summary: RepoCardSummary;
  onClick?: (ownerRepo: string | null) => void;
}

const KIND_ICON: Record<RepoCardKind, string> = {
  synced: "✓",
  diverged: "⚠",
  dirty: "⚠",
  conflict: "🚨",
  partial: "◦",
};

const KIND_LABEL: Record<RepoCardKind, string> = {
  synced: "동기화됨",
  diverged: "발산",
  dirty: "미커밋",
  conflict: "충돌 임박",
  partial: "단일 호스트",
};

/**
 * Derive the card's verdict from raw host statuses + dirty-file overlap.
 * Same priority Windows uses: conflict > partial > diverged > dirty > synced.
 */
export function classifyCard(summary: RepoCardSummary): {
  kind: RepoCardKind;
  overlaps: string[];
} {
  const vals = Object.values(summary.byHost);
  // dirty file overlap (same file dirty across two+ OSes → conflict)
  const filesByOs = new Map<string, Set<string>>();
  for (const v of vals) {
    for (const df of v.dirty_files ?? []) {
      const name = dirtyFileName(df);
      if (!name) continue;
      const set = filesByOs.get(name) ?? new Set();
      set.add(v.os || "?");
      filesByOs.set(name, set);
    }
  }
  const overlaps = [...filesByOs.entries()]
    .filter(([, hostsSet]) => hostsSet.size > 1)
    .map(([f]) => f);

  if (overlaps.length > 0) return { kind: "conflict", overlaps };
  if (vals.length < 2) return { kind: "partial", overlaps: [] };

  const headsDiffer = new Set(vals.map((v) => v.head)).size > 1;
  if (headsDiffer) return { kind: "diverged", overlaps: [] };

  const anyDirty = vals.some(
    (v) => (v.dirty || 0) || (v.unpushed || 0) || (v.behind || 0),
  );
  if (anyDirty) return { kind: "dirty", overlaps: [] };
  return { kind: "synced", overlaps: [] };
}

function dirtyFileName(porcelainLine: string): string {
  const s = porcelainLine.trim();
  const i = s.indexOf(" ");
  return i < 0 ? s : s.slice(i + 1).trim();
}

export function RepoCard({ summary, onClick }: Props) {
  const { kind, overlaps } = classifyCard(summary);
  const vals = Object.values(summary.byHost);
  const mac = vals.find((v) => v.os === "macos") ?? null;
  const win = vals.find((v) => v.os === "windows") ?? null;

  return (
    <article
      className={`git-card git-card-${kind}`}
      data-or={summary.ownerRepo ?? ""}
      onClick={() => onClick?.(summary.ownerRepo)}
      role="button"
      tabIndex={0}
    >
      {kind === "conflict" && <div className="git-card-stripe" />}
      <header className="git-card-head">
        <div className="git-card-title-wrap">
          <h3 className="git-card-name">{summary.label}</h3>
          <div className="git-card-meta">
            <span aria-hidden>🕒</span>
            <span>방금 전 스캔</span>
          </div>
        </div>
        <span className={`git-card-badge git-card-badge-${kind}`}>
          <span aria-hidden>{KIND_ICON[kind]}</span>
          <span>{KIND_LABEL[kind]}</span>
        </span>
      </header>

      <ThreeNodeBridge mac={mac} win={win} remote={summary.remote} />

      {overlaps.length > 0 && (
        <div className="git-card-conflict">
          <span aria-hidden>🚨</span>
          <span>
            <b>{overlaps.length}개 파일</b>이 양쪽 머신에서 동시 수정 중입니다.
          </span>
        </div>
      )}
    </article>
  );
}
