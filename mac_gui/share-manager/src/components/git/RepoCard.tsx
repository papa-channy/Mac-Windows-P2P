// RepoCard — one row in the L1 dashboard's "Repo Card grid". Aggregates
// every host's per-repo status into a single card with badge + 3-node
// bridge + optional conflict banner. Mirror of windows_gui/.../app.js
// renderGitL1Card + gitRepoSummary.
//
// Title uses `text-overflow: ellipsis; white-space: nowrap` so long
// owner/repo strings shrink instead of word-wrapping vertically (which
// was breaking conflict cards into 1-char-per-line columns).

import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  CircleDot,
  Clock,
  ChevronRight,
} from "lucide-react";
// ShieldAlert is referenced through KIND_ICON below for the conflict
// badge; the standalone import keeps tree-shaking happy.
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

const KIND_ICON: Record<RepoCardKind, typeof CheckCircle2> = {
  synced: CheckCircle2,
  diverged: AlertTriangle,
  dirty: AlertTriangle,
  conflict: ShieldAlert,
  partial: CircleDot,
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
  const KindIcon = KIND_ICON[kind];

  // Badge label stays short (matches "발산" / "미커밋" / etc) so the
  // title column never gets pushed into a 1-char-per-line wrap when
  // the card is narrow. Conflict file count + names live in the badge
  // tooltip and on the bridge node.
  const badgeTitle =
    kind === "conflict"
      ? `충돌 임박 · ${overlaps.length}개 파일 동시 수정 중\n${overlaps.join("\n")}`
      : undefined;

  return (
    <article
      className={`git-card git-card-${kind}`}
      data-or={summary.ownerRepo ?? ""}
      onClick={() => onClick?.(summary.ownerRepo)}
      role="button"
      tabIndex={0}
    >
      <header className="git-card-head">
        <div className="git-card-title-wrap">
          <h3 className="git-card-name" title={summary.label}>
            {summary.label}
          </h3>
          <div className="git-card-meta">
            <Clock size={11} />
            <span>방금 전 스캔</span>
          </div>
        </div>
        <span
          className={`git-card-badge git-card-badge-${kind}`}
          title={badgeTitle}
        >
          <KindIcon size={12} />
          <span>{KIND_LABEL[kind]}</span>
        </span>
      </header>

      <ThreeNodeBridge mac={mac} win={win} remote={summary.remote} />

      <ChevronRight size={16} className="git-card-chev" />
    </article>
  );
}
