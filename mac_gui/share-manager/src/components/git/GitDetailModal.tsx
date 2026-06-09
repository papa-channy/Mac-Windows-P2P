// GitDetailModal — T1.5 L2 layer. Opens when a Repo Card is clicked.
// Three swimlanes (mac / origin / win) + connector bar showing the
// ahead/behind summary. Mirror of windows_gui/.../app.js
// renderGitL2Lanes + gitLaneCol + gitLaneOrigin + gitConnectorBar.
//
// ADR-0002: header uses a fixed-column grid (`grid-template-columns:
// minmax(0,1fr) auto auto auto; overflow: hidden`) so the title
// ellipsises first while branch select / Inspector button / close X
// keep their natural sizes.

import { useEffect, useMemo, useState } from "react";
import {
  Apple,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  CircleDot,
  Terminal,
  X,
  FileCode2,
  GitCommit,
  Package,
  GitPullRequest,
  ArrowUp,
  ArrowDown,
  FileWarning,
} from "lucide-react";
import { GithubBrand, WindowsBrand } from "./BrandIcons";
import { useGitStore } from "../../lib/gitStore";
import type { RepoStatus, RemoteRepoState } from "../../lib/api";
import { classifyCard, type RepoCardSummary } from "./RepoCard";
import { GitOpsBar } from "./GitOpsBar";

interface Props {
  isOpen: boolean;
  ownerRepo: string | null;
  onClose: () => void;
  onOpenInspector: (ownerRepo: string) => void;
}

interface LaneHost {
  host: string;
  os: string;
  repo: RepoStatus & { os: string };
}

export function GitDetailModal({
  isOpen,
  ownerRepo,
  onClose,
  onOpenInspector,
}: Props) {
  const store = useGitStore();
  const [branch, setBranch] = useState<string>("");

  // Reset branch when the modal opens for a new repo
  useEffect(() => {
    if (isOpen) setBranch("");
  }, [isOpen, ownerRepo]);

  const data = useMemo(() => {
    if (!ownerRepo) return null;
    const entries: LaneHost[] = [];
    for (const snap of store.snapshots) {
      const r = snap.repos.find((x) => x.owner_repo === ownerRepo);
      if (r) {
        entries.push({
          host: snap.host,
          os: snap.os,
          repo: { ...r, os: snap.os },
        });
      }
    }
    const remote =
      store.remoteCache?.repos.find((r) => r.owner_repo === ownerRepo) ?? null;

    const byHost: Record<string, RepoStatus & { os: string }> = {};
    for (const e of entries) byHost[e.host] = e.repo;
    const summary: RepoCardSummary = {
      ownerRepo,
      label: ownerRepo,
      byHost,
      remote,
    };
    const { kind, overlaps } = classifyCard(summary);

    const branchSet = new Set<string>();
    for (const e of entries) if (e.repo.branch) branchSet.add(e.repo.branch);
    if (remote?.branches) {
      for (const b of remote.branches) if (b.name) branchSet.add(b.name);
    }
    if (remote?.default_branch) branchSet.add(remote.default_branch);
    const branches = [...branchSet];

    return { entries, remote, kind, overlaps, branches };
  }, [ownerRepo, store.snapshots, store.remoteCache]);

  if (!isOpen || !ownerRepo) return null;

  if (!data || data.entries.length === 0) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="git-detail-shell"
          onClick={(e) => e.stopPropagation()}
        >
          <DetailHeader
            ownerRepo={ownerRepo}
            branches={[]}
            selectedBranch=""
            onBranchChange={() => void 0}
            onOpenInspector={() => onOpenInspector(ownerRepo)}
            onClose={onClose}
          />
          <div className="git-detail-loading">
            이 레포의 스냅샷이 없어요.
          </div>
        </div>
      </div>
    );
  }

  const { entries, remote, kind, overlaps, branches } = data;
  const macHost = entries.find((e) => e.os === "macos") ?? null;
  const winHost = entries.find((e) => e.os === "windows") ?? null;

  const macAhead = macHost?.repo.ahead ?? macHost?.repo.unpushed ?? 0;
  const macBehind = macHost?.repo.behind ?? 0;
  const winAhead = winHost?.repo.ahead ?? winHost?.repo.unpushed ?? 0;
  const winBehind = winHost?.repo.behind ?? 0;

  const effectiveBranch =
    branch ||
    (remote?.default_branch && branches.includes(remote.default_branch)
      ? remote.default_branch
      : branches[0] ?? "main");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="git-detail-shell" onClick={(e) => e.stopPropagation()}>
        <DetailHeader
          ownerRepo={ownerRepo}
          branches={branches}
          selectedBranch={effectiveBranch}
          onBranchChange={setBranch}
          onOpenInspector={() => onOpenInspector(ownerRepo)}
          onClose={onClose}
        />
        <VerdictRow
          kind={kind}
          macAhead={macAhead}
          macBehind={macBehind}
          winAhead={winAhead}
          winBehind={winBehind}
          overlaps={overlaps.length}
        />

        <GitOpsBar repoPath={macHost?.repo.path ?? null} />

        <div className="git-l2-shell">
          {overlaps.length > 0 && <div className="git-l2-pulse" />}
          <LaneCol
            kind="mac"
            label="macOS 로컬"
            host={macHost}
            ahead={macAhead}
            behind={macBehind}
            overlaps={overlaps}
          />
          <OriginLane remote={remote} />
          <LaneCol
            kind="win"
            label="Windows 로컬"
            host={winHost}
            ahead={winAhead}
            behind={winBehind}
            overlaps={overlaps}
          />
        </div>

        <ConnectorBar
          macAhead={macAhead}
          macBehind={macBehind}
          winAhead={winAhead}
          winBehind={winBehind}
        />
      </div>
    </div>
  );
}

function DetailHeader({
  ownerRepo,
  branches,
  selectedBranch,
  onBranchChange,
  onOpenInspector,
  onClose,
}: {
  ownerRepo: string;
  branches: string[];
  selectedBranch: string;
  onBranchChange: (b: string) => void;
  onOpenInspector: () => void;
  onClose: () => void;
}) {
  return (
    <header className="git-detail-head">
      <h2 className="git-detail-title" title={ownerRepo}>
        {ownerRepo}
      </h2>
      <select
        className="git-detail-branch"
        value={selectedBranch}
        onChange={(e) => onBranchChange(e.target.value)}
        title={selectedBranch}
        disabled={branches.length === 0}
      >
        {branches.length === 0 ? (
          <option>{selectedBranch || "—"}</option>
        ) : (
          branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))
        )}
      </select>
      <button
        className="git-detail-inspector-btn"
        onClick={onOpenInspector}
        title="Raw Inspector — diffs / logs / config / commits / sync timeline"
      >
        <Terminal size={14} />
        <span>Inspector</span>
      </button>
      <button
        className="git-detail-close"
        onClick={onClose}
        aria-label="닫기"
      >
        <X size={16} />
      </button>
    </header>
  );
}

const KIND_ICON: Record<string, typeof CheckCircle2> = {
  synced: CheckCircle2,
  dirty: AlertTriangle,
  diverged: AlertTriangle,
  partial: CircleDot,
  conflict: ShieldAlert,
};

const KIND_LABEL: Record<string, string> = {
  synced: "동기화됨",
  dirty: "미커밋",
  diverged: "발산",
  partial: "단일 호스트",
  conflict: "충돌 임박",
};

// ADR-0006: large verdict row — big chip + one-line diagnosis + recommended
// action. Same verdict→action mapping the narrative uses, computed from the
// already-derived ahead/behind/overlap counts (no RepoGraph fetch needed).
function deriveVerdict(
  kind: string,
  ma: number,
  mb: number,
  wa: number,
  wb: number,
  overlaps: number,
): { headline: string; action: string } {
  if (overlaps > 0)
    return {
      headline: "충돌 임박",
      action: "양쪽에서 같은 파일 수정 중 · 머지 전 정리 필요",
    };
  if (ma > 0 && wa > 0)
    return {
      headline: `양쪽 발산 · Mac ↑${ma} / Win ↑${wa}`,
      action: "양쪽 미푸시 — 통합 결정 후 한쪽씩 push",
    };
  if (ma > 0)
    return {
      headline: `Mac이 origin보다 ${ma}커밋 앞섬`,
      action: "Mac에서 push 후 Win에서 pull 권장",
    };
  if (wa > 0)
    return {
      headline: `Win이 origin보다 ${wa}커밋 앞섬`,
      action: "Mac은 깨끗하고 동기화됨 · Win에서 push 권장",
    };
  if (mb > 0 || wb > 0)
    return {
      headline: "뒤처짐 · pull 필요",
      action: "원격이 앞서 있어요 · git pull 권장",
    };
  if (kind === "dirty")
    return {
      headline: "미커밋 변경",
      action: "로컬 변경 커밋 후 push 권장",
    };
  if (kind === "partial")
    return {
      headline: "단일 호스트",
      action: "한쪽 호스트만 이 레포를 보고 있어요",
    };
  return { headline: "동기화됨", action: "모든 호스트가 origin과 일치" };
}

function VerdictRow({
  kind,
  macAhead,
  macBehind,
  winAhead,
  winBehind,
  overlaps,
}: {
  kind: string;
  macAhead: number;
  macBehind: number;
  winAhead: number;
  winBehind: number;
  overlaps: number;
}) {
  const Icon = KIND_ICON[kind] ?? CircleDot;
  const { headline, action } = deriveVerdict(
    kind,
    macAhead,
    macBehind,
    winAhead,
    winBehind,
    overlaps,
  );
  return (
    <div className={`git-l2-verdict-row ${kind}`}>
      <span className={`git-l2-verdict-chip ${kind}`}>
        <Icon size={14} />
        <span>{KIND_LABEL[kind]}</span>
      </span>
      <div className="git-l2-verdict-text">
        <b>{headline}</b>
        <span>{action}</span>
      </div>
    </div>
  );
}

function LaneCol({
  kind,
  label,
  host,
  ahead,
  behind,
  overlaps,
}: {
  kind: "mac" | "win";
  label: string;
  host: LaneHost | null;
  ahead: number;
  behind: number;
  overlaps: string[];
}) {
    if (!host) {
    return (
      <section className={`git-lane ${kind} off`}>
        <header className="lane-head">
          <span className="lane-icon">{kind === "mac" ? <Apple size={20} fill="currentColor" strokeWidth={0} /> : <WindowsBrand size={20} />}</span>
          <div className="lane-meta">
            <h3 className="lane-title">{label}</h3>
            <div className="lane-sub">연결되지 않음</div>
          </div>
        </header>
        <div className="lane-body empty">
          <div className="empty-pad">
            <CircleDot size={22} />
            <div>이 호스트엔 이 레포가 없어요</div>
          </div>
        </div>
      </section>
    );
  }
  const repo = host.repo;
  const dirty = repo.dirty_files ?? [];
  const unpushed = repo.unpushed || repo.ahead || 0;
  const stash = repo.stash || 0;

  return (
    <section className={`git-lane ${kind}`}>
      <header className="lane-head">
        <span className="lane-icon">{kind === "mac" ? <Apple size={20} fill="currentColor" strokeWidth={0} /> : <WindowsBrand size={20} />}</span>
        <div className="lane-meta">
          <h3 className="lane-title">{label}</h3>
          <div className="lane-sub">
            <span className="lane-host">{host.host}</span>
            <span className="lane-sep">·</span>
            <span className="mono">{(repo.head || "").slice(0, 7)}</span>
          </div>
        </div>
        <div className="lane-tags">
          {ahead > 0 && (
            <span className={`git-tag ${kind}-tag`}><ArrowUp size={10} />{ahead}</span>
          )}
          {behind > 0 && <span className="git-tag warn-tag"><ArrowDown size={10} />{behind}</span>}
        </div>
      </header>
      <div className="lane-body">
        <h4 className="lane-section">
          <FileCode2 size={12} />
          <span>Work In Progress</span>
          <span className="lane-count">{dirty.length}</span>
        </h4>
        <ul className="lane-files">
          {dirty.length === 0 ? (
            <li className="lane-empty">
              <CheckCircle2 size={12} />
              <span>변경 없음</span>
            </li>
          ) : (
            dirty.map((df, i) => {
              const name = dirtyFileName(df);
              const isConflict = overlaps.includes(name);
              return (
                <li
                  key={i}
                  className={"lane-file" + (isConflict ? " conflict" : "")}
                >
                  <span className="lane-file-ic">
                    {isConflict ? <FileWarning size={12} /> : <FileCode2 size={12} />}
                  </span>
                  <span
                    className={
                      "lane-file-name" + (isConflict ? " bold" : "")
                    }
                    title={df}
                  >
                    {name}
                  </span>
                  {isConflict && (
                    <span className="lane-file-tag">CONFLICT</span>
                  )}
                </li>
              );
            })
          )}
        </ul>
        {unpushed > 0 && (
          <>
            <h4 className="lane-section">
              <GitCommit size={12} />
              <span>미푸시 커밋</span>
              <span className="lane-count">{unpushed}</span>
            </h4>
            <ul className="lane-files">
              <li className="lane-info">
                <ArrowUp size={12} />
                <span>{unpushed}개 로컬에서 커밋했지만 origin엔 없음</span>
              </li>
            </ul>
          </>
        )}
        {stash > 0 && (
          <>
            <h4 className="lane-section">
              <Package size={12} />
              <span>Stash</span>
              <span className="lane-count">{stash}</span>
            </h4>
            <ul className="lane-files">
              <li className="lane-info">
                <Package size={12} />
                <span>{stash}개 보관됨</span>
              </li>
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function OriginLane({ remote }: { remote: RemoteRepoState | null }) {
  const tip = remote?.default_sha ? remote.default_sha.slice(0, 7) : "—";
  const def = remote?.default_branch || "main";
  const prs = remote?.open_prs ?? [];

  return (
    <section className="git-lane remote">
      <header className="lane-head">
        <span className="lane-icon"><GithubBrand size={20} /></span>
        <div className="lane-meta">
          <h3 className="lane-title">GitHub Origin</h3>
          <div className="lane-sub">
            <span className="lane-host">{def}</span>
            <span className="lane-sep">·</span>
            <span className="mono">{tip}</span>
          </div>
        </div>
        {prs.length > 0 && (
          <span className="git-tag remote-tag"><GitPullRequest size={10} />PR {prs.length}</span>
        )}
      </header>
      <div className="lane-body lane-origin">
        <div className="origin-tip">
          <div className="origin-dot" />
          <div className="origin-card">
            <div className="origin-sha mono">{tip}</div>
            <div className="origin-msg">
              {remote?.error ? remote.error : `${def} 최신 커밋`}
            </div>
          </div>
        </div>
        {prs.length > 0 && (
          <>
            <h4 className="lane-section">
              <GitPullRequest size={12} />
              <span>열린 PR</span>
              <span className="lane-count">{prs.length}</span>
            </h4>
            <ul className="lane-files">
              {prs.slice(0, 5).map((p) => (
                <li key={p.number} className="lane-info lane-pr">
                  <span className="lane-pr-num">#{p.number}</span>
                  <span className="lane-pr-title">{p.title}</span>
                  <span className="lane-pr-branch mono">
                    {p.head} → {p.base}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function ConnectorBar({
  macAhead,
  macBehind,
  winAhead,
  winBehind,
}: {
  macAhead: number;
  macBehind: number;
  winAhead: number;
  winBehind: number;
}) {
  return (
    <div className="git-l2-connbar">
      <span className="conn-label mac">
        <Apple size={14} fill="currentColor" strokeWidth={0} />
        <span>Mac</span>
      </span>
      <span className="conn-arrows mac">
        <ConnectorSummary ahead={macAhead} behind={macBehind} />
      </span>
      <span className="conn-mid">
        <GithubBrand size={14} />
        <span>Origin</span>
      </span>
      <span className="conn-arrows win">
        <ConnectorSummary ahead={winAhead} behind={winBehind} />
      </span>
      <span className="conn-label win">
        <WindowsBrand size={14} />
        <span>Win</span>
      </span>
    </div>
  );
}

function ConnectorSummary({ ahead, behind }: { ahead: number; behind: number }) {
  if (!ahead && !behind) {
    return (
      <span className="conn-eq">
        <CheckCircle2 size={12} />
        <span>동기화</span>
      </span>
    );
  }
  return (
    <>
      {ahead > 0 && <span className="conn-up"><ArrowUp size={11} />{ahead}</span>}
      {behind > 0 && <span className="conn-down"><ArrowDown size={11} />{behind}</span>}
    </>
  );
}

function dirtyFileName(porcelain: string): string {
  const s = porcelain.trim();
  const i = s.indexOf(" ");
  return i < 0 ? s : s.slice(i + 1).trim();
}
