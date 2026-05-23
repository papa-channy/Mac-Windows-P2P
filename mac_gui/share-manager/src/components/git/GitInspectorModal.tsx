// GitInspectorModal — T1.6 L3 Raw Data Inspector. ADR-0001 light theme.
// Opened from L2 modal's "Inspector" button. Mirror of
// windows_gui/.../app.js openGitInspector + renderGitInspectorTab.
//
// 5 tabs in a left-rail "DATA CATEGORIES" sidebar:
//   1. Raw Diffs    — `git diff HEAD` per dirty file (GitHub-light colors)
//   2. Daemon Logs  — recent send/recv/error/worklog rows in a 4-col grid
//   3. Git Config   — raw `.git/config` dump (mono, light surface)
//   4. All Commits  — unified table from list_git_logs across all hosts
//   5. Sync Timeline — Status Summary + SVG graph + selected commit (ADR-0003/0004)

import { useEffect, useMemo, useState } from "react";
import { api, type RepoGraph, type RepoGraphCommit } from "../../lib/api";
import { useGitStore } from "../../lib/gitStore";
import { computeGitNarrative } from "../../lib/computeGitNarrative";

type TabId = "diffs" | "logs" | "config" | "commits" | "timeline";

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: "diffs", label: "Raw Diffs", emoji: "📄" },
  { id: "logs", label: "Daemon Logs", emoji: "📡" },
  { id: "config", label: "Git Config", emoji: "⚙" },
  { id: "commits", label: "All Commits", emoji: "🌳" },
  { id: "timeline", label: "Sync Timeline", emoji: "🌿" },
];

interface Props {
  isOpen: boolean;
  ownerRepo: string | null;
  onClose: () => void;
  onBack: () => void;
}

export function GitInspectorModal({ isOpen, ownerRepo, onClose, onBack }: Props) {
  const [tab, setTab] = useState<TabId>("diffs");

  useEffect(() => {
    if (isOpen) setTab("diffs");
  }, [isOpen, ownerRepo]);

  if (!isOpen || !ownerRepo) return null;

  return (
    <div className="modal-overlay gi-overlay" onClick={onClose}>
      <div className="gi-shell light" onClick={(e) => e.stopPropagation()}>
        <header className="gi-head">
          <button className="gi-back" onClick={onBack} aria-label="뒤로">
            ‹
          </button>
          <span className="gi-title-ic">{">_"}</span>
          <span className="gi-title-repo mono">{ownerRepo}</span>
          <span className="gi-title-sep">/</span>
          <span className="gi-title-label">Inspector</span>
          <button className="gi-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="gi-body">
          <nav className="gi-tabs">
            <div className="gi-tabs-head">DATA CATEGORIES</div>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={"gi-tab" + (t.id === tab ? " active" : "")}
                onClick={() => setTab(t.id)}
              >
                <span className="gi-tab-ic" aria-hidden>
                  {t.emoji}
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="gi-pane">
            {tab === "diffs" && <RawDiffsTab ownerRepo={ownerRepo} />}
            {tab === "logs" && <DaemonLogsTab />}
            {tab === "config" && <GitConfigTab ownerRepo={ownerRepo} />}
            {tab === "commits" && <AllCommitsTab ownerRepo={ownerRepo} />}
            {tab === "timeline" && <SyncTimelineTab ownerRepo={ownerRepo} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 1: Raw Diffs ─────────────────────────────────────────────

function RawDiffsTab({ ownerRepo }: { ownerRepo: string }) {
  const store = useGitStore();
  const [diffs, setDiffs] = useState<{ file: string; text: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefer the macOS snapshot since this is the Mac app; fall back to any host
  const localRepo = useMemo(() => {
    for (const snap of store.snapshots) {
      const r = snap.repos.find((x) => x.owner_repo === ownerRepo);
      if (!r) continue;
      if (snap.os === "macos") return { path: r.path, dirty: r.dirty_files ?? [] };
    }
    for (const snap of store.snapshots) {
      const r = snap.repos.find((x) => x.owner_repo === ownerRepo);
      if (r) return { path: r.path, dirty: r.dirty_files ?? [] };
    }
    return null;
  }, [store.snapshots, ownerRepo]);

  useEffect(() => {
    let cancelled = false;
    setDiffs(null);
    setError(null);
    if (!localRepo) {
      setError("이 머신엔 이 레포가 없어요.");
      return;
    }
    (async () => {
      try {
        const files = localRepo.dirty
          .map(dirtyFileName)
          .filter((s) => s.length > 0)
          .slice(0, 8);
        const out: { file: string; text: string }[] = [];
        for (const file of files) {
          try {
            const text = await api.git.fileDiff(localRepo.path, file, "working");
            out.push({ file, text: text || "(no diff hunks)" });
          } catch (e) {
            out.push({ file, text: `(read failed: ${e})` });
          }
        }
        if (!cancelled) setDiffs(out);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localRepo]);

  if (error) return <div className="gi-empty">{error}</div>;
  if (diffs === null) return <div className="gi-loading">읽는 중…</div>;
  if (diffs.length === 0)
    return <div className="gi-empty">변경된 파일이 없습니다 — diff 없음</div>;

  return (
    <div className="gi-diffs">
      {diffs.map((d) => (
        <div className="gi-diff-card" key={d.file}>
          <header className="gi-diff-head">
            <span aria-hidden>📄</span>
            <span className="mono">{d.file}</span>
          </header>
          <pre className="gi-diff-pre">{renderDiff(d.text)}</pre>
        </div>
      ))}
    </div>
  );
}

function renderDiff(text: string): JSX.Element[] {
  return text.split("\n").map((line, i) => {
    let cls = "d-ctx";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "d-meta";
    else if (line.startsWith("@@")) cls = "d-hunk";
    else if (line.startsWith("+")) cls = "d-add";
    else if (line.startsWith("-")) cls = "d-del";
    return (
      <span key={i} className={cls}>
        {line + "\n"}
      </span>
    );
  });
}

// ─── Tab 2: Daemon Logs ───────────────────────────────────────────

function DaemonLogsTab() {
  const [rows, setRows] = useState<
    | null
    | { ts: string; level: string; cat: string; main: string }[]
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cats: ("send" | "recv" | "error" | "worklog")[] = [
        "recv",
        "send",
        "error",
        "worklog",
      ];
      const all: { ts: string; level: string; cat: string; main: string }[] = [];
      for (const c of cats) {
        try {
          const entries = await api.listLogEntries(c, 50);
          for (const e of entries) {
            const level =
              e.event && /fail|error/i.test(e.event)
                ? "ERROR"
                : e.event && /ok/i.test(e.event)
                ? "SUCCESS"
                : "INFO";
            const main =
              e.summary ?? e.event ?? JSON.stringify(e).slice(0, 120);
            all.push({ ts: e.ts ?? "", level, cat: c, main });
          }
        } catch {
          /* swallow per-category */
        }
      }
      all.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
      if (!cancelled) setRows(all.slice(0, 80));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows === null) return <div className="gi-loading">읽는 중…</div>;
  if (rows.length === 0)
    return <div className="gi-empty">아직 로그가 없습니다.</div>;

  return (
    <div className="gi-logs">
      {rows.map((l, i) => {
        const cls =
          l.level === "ERROR"
            ? "l-err"
            : l.level === "SUCCESS"
            ? "l-ok"
            : "l-info";
        return (
          <div key={i} className="gi-log-line">
            <span className="l-ts mono">{(l.ts || "").slice(11, 19)}</span>
            <span className={`l-lvl ${cls}`}>{l.level}</span>
            <span className="l-cat">{l.cat.toUpperCase()}</span>
            <span className="l-msg">{l.main}</span>
          </div>
        );
      })}
      <div className="gi-log-tail">_ waiting for new logs…</div>
    </div>
  );
}

// ─── Tab 3: Git Config ────────────────────────────────────────────

function GitConfigTab({ ownerRepo }: { ownerRepo: string }) {
  const store = useGitStore();
  const [conf, setConf] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const localRepo = useMemo(() => {
    for (const snap of store.snapshots) {
      const r = snap.repos.find((x) => x.owner_repo === ownerRepo);
      if (!r) continue;
      if (snap.os === "macos") return r.path;
    }
    for (const snap of store.snapshots) {
      const r = snap.repos.find((x) => x.owner_repo === ownerRepo);
      if (r) return r.path;
    }
    return null;
  }, [store.snapshots, ownerRepo]);

  useEffect(() => {
    let cancelled = false;
    setConf(null);
    setError(null);
    if (!localRepo) {
      setError("이 머신엔 이 레포 없음.");
      return;
    }
    (async () => {
      try {
        const text = await api.git.configRead(localRepo);
        if (!cancelled) setConf({ path: localRepo, text });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localRepo]);

  if (error) return <div className="gi-empty">{error}</div>;
  if (!conf) return <div className="gi-loading">읽는 중…</div>;

  return (
    <div className="gi-config">
      <div className="gi-config-path">
        <span aria-hidden>⚙</span>
        <span className="mono">{conf.path}/.git/config</span>
      </div>
      <pre className="gi-config-pre">{conf.text}</pre>
    </div>
  );
}

// ─── Tab 4: All Commits ───────────────────────────────────────────

function AllCommitsTab({ ownerRepo }: { ownerRepo: string }) {
  const [rows, setRows] = useState<
    | null
    | {
        sha: string;
        msg: string;
        branch: string;
        author: string;
        date: string;
      }[]
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docs = await api.git.listLogs();
        const all: {
          sha: string;
          msg: string;
          branch: string;
          author: string;
          date: string;
        }[] = [];
        for (const doc of Object.values(docs)) {
          const repoLogs = doc.logs?.[ownerRepo];
          if (!repoLogs) continue;
          for (const [branch, arr] of Object.entries(repoLogs)) {
            for (const c of arr) {
              all.push({
                sha: c.sha,
                msg: c.msg,
                branch,
                author: c.author,
                date: c.date,
              });
            }
          }
        }
        const seen = new Set<string>();
        const dedup = all.filter((c) =>
          seen.has(c.sha) ? false : (seen.add(c.sha), true),
        );
        dedup.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        if (!cancelled) setRows(dedup.slice(0, 200));
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerRepo]);

  if (rows === null) return <div className="gi-loading">읽는 중…</div>;
  if (rows.length === 0)
    return (
      <div className="gi-empty">
        아직 커밋 로그가 없습니다 — "지금 스캔" 으로 생성하세요
      </div>
    );

  return (
    <div className="gi-commits">
      <table className="gi-table">
        <thead>
          <tr>
            <th>SHA</th>
            <th>Message</th>
            <th>Branch</th>
            <th>Author</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.sha}>
              <td className="d-add mono">{c.sha.slice(0, 7)}</td>
              <td>{c.msg}</td>
              <td className="d-meta">{c.branch}</td>
              <td className="d-meta">{c.author}</td>
              <td className="d-meta nowrap">{fmtRelative(c.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab 5: Sync Timeline ─────────────────────────────────────────

function SyncTimelineTab({ ownerRepo }: { ownerRepo: string }) {
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RepoGraphCommit | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setSelected(null);
    setError(null);
    (async () => {
      try {
        const g = await api.git.buildRepoGraph(ownerRepo);
        if (cancelled) return;
        setGraph(g);
        const defBranch =
          g.default_branch && g.per_branch[g.default_branch]
            ? g.default_branch
            : Object.keys(g.per_branch)[0];
        if (defBranch) {
          const commits = g.per_branch[defBranch]?.commits ?? [];
          const ancestor = commits.find((c) => c.ancestor) ?? commits[0] ?? null;
          setSelected(ancestor);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerRepo]);

  if (error) return <div className="gi-empty">{error}</div>;
  if (!graph) return <div className="gi-loading">3-소스 그래프 계산 중…</div>;

  const branch =
    graph.default_branch && graph.per_branch[graph.default_branch]
      ? graph.default_branch
      : Object.keys(graph.per_branch)[0];
  if (!branch) return <div className="gi-empty">데이터 없음</div>;
  const pb = graph.per_branch[branch];

  const narrative = computeGitNarrative(graph, branch);

  return (
    <div className="gi-timeline">
      <TimelineStatusPanel
        narrative={narrative}
        graph={graph}
        branch={branch}
        pointers={pb.pointers}
      />
      <TimelineGraphPanel
        graph={graph}
        branch={branch}
        onSelectCommit={setSelected}
      />
      <TimelineDetailPanel commit={selected} graph={graph} />
    </div>
  );
}

function TimelineStatusPanel({
  narrative,
  graph,
  branch,
  pointers,
}: {
  narrative: ReturnType<typeof computeGitNarrative>;
  graph: RepoGraph;
  branch: string;
  pointers: Record<string, string>;
}) {
  const kindIcon: Record<string, string> = {
    synced: "✓",
    warn: "⚠",
    danger: "🚨",
    partial: "◦",
  };
  const lcaSha = narrative.commonAncestor
    ? narrative.commonAncestor.slice(0, 7)
    : "범위 밖";

  const hosts = graph.hosts;
  const macHost = hosts.find((h) => h.os === "macos");
  const winHost = hosts.find((h) => h.os === "windows");
  const summary = graph.per_branch[branch]?.summary ?? {};

  return (
    <section className={`gtl-status gtl-status-${narrative.verdict}`}>
      <header className="gtl-status-head">
        <span className="gtl-status-icon">{kindIcon[narrative.verdict]}</span>
        <div>
          <h3 className="gtl-status-title">{narrative.headline}</h3>
          <div className="gtl-status-sub">
            {branch} 브랜치 · 공통 조상 <span className="mono">{lcaSha}</span>
          </div>
        </div>
      </header>
      <div className="gtl-status-rows">
        <HostRow
          cls="remote"
          emoji="📦"
          name="GitHub origin"
          sha={pointers.remote}
          chip={<span className="gtl-chip remote-tag">기준</span>}
        />
        {macHost ? (
          <HostRow
            cls="mac"
            emoji="🍎"
            name={macHost.host}
            sha={pointers[macHost.host]}
            chip={renderSummaryChip(summary[macHost.host])}
          />
        ) : (
          <HostRowOff cls="mac" emoji="🍎" label="macOS" />
        )}
        {winHost ? (
          <HostRow
            cls="win"
            emoji="🪟"
            name={winHost.host}
            sha={pointers[winHost.host]}
            chip={renderSummaryChip(summary[winHost.host])}
          />
        ) : (
          <HostRowOff cls="win" emoji="🪟" label="Windows" />
        )}
      </div>
      {narrative.action && (
        <div className="gtl-action">
          <span aria-hidden>⚡</span>
          <span className="gtl-action-text">{narrative.action}</span>
        </div>
      )}
    </section>
  );
}

function HostRow({
  cls,
  emoji,
  name,
  sha,
  chip,
}: {
  cls: string;
  emoji: string;
  name: string;
  sha: string | undefined;
  chip: JSX.Element | null;
}) {
  return (
    <div className={`gtl-row gtl-row-${cls}`}>
      <span className="gtl-row-ic" aria-hidden>
        {emoji}
      </span>
      <span className="gtl-row-name">{name}</span>
      <span className="gtl-row-sha mono">
        {sha ? sha.slice(0, 7) : "—"}
      </span>
      <span className="gtl-row-chips">{chip}</span>
    </div>
  );
}

function HostRowOff({
  cls,
  emoji,
  label,
}: {
  cls: string;
  emoji: string;
  label: string;
}) {
  return (
    <div className={`gtl-row gtl-row-${cls} off`}>
      <span className="gtl-row-ic" aria-hidden>
        {emoji}
      </span>
      <span className="gtl-row-name">
        {label} <span className="gtl-row-off">(스캔 데이터 없음)</span>
      </span>
      <span className="gtl-row-sha mono">—</span>
      <span className="gtl-row-chips">
        <span className="gtl-chip muted">단일 호스트</span>
      </span>
    </div>
  );
}

function renderSummaryChip(s: {
  ahead: number;
  behind: number;
  has_remote: boolean;
} | undefined): JSX.Element | null {
  if (!s) return null;
  if (!s.ahead && !s.behind && s.has_remote) {
    return (
      <span className="gtl-chip eq">
        <span aria-hidden>✓</span>
        <span>origin과 동일</span>
      </span>
    );
  }
  return (
    <>
      {s.ahead > 0 && <span className="gtl-chip ahead">↑{s.ahead}</span>}
      {s.behind > 0 && <span className="gtl-chip behind">↓{s.behind}</span>}
    </>
  );
}

// SVG timeline graph — port of windows_gui/.../app.js gitTimelineSVG.
// Click handler routed through React `onClick` on each <circle>.
function TimelineGraphPanel({
  graph,
  branch,
  onSelectCommit,
}: {
  graph: RepoGraph;
  branch: string;
  onSelectCommit: (c: RepoGraphCommit) => void;
}) {
  const pb = graph.per_branch[branch];
  const all = [...(pb?.commits ?? [])].reverse();
  let start = 0;
  const ancFromOld = all.findIndex((c) => c.ancestor);
  if (ancFromOld >= 0) start = Math.max(0, ancFromOld - 2);
  const win = all.slice(start);
  const n = win.length;

  if (n === 0) {
    return (
      <section className="gtl-graph">
        <header className="gtl-graph-head">
          <span className="mono">{graph.owner_repo}</span>
          <span className="gtl-sep">·</span>
          <span>{branch}</span>
        </header>
        <div className="gi-empty">커밋 없음</div>
      </section>
    );
  }

  const srcKeys = ["remote", ...graph.hosts.map((h) => h.host)];
  const lanes = srcKeys.map((k, idx) => {
    const os = graph.hosts.find((h) => h.host === k)?.os ?? "";
    const cls = k === "remote" ? "remote" : os === "macos" ? "mac" : "win";
    return {
      key: k,
      idx,
      label: k === "remote" ? "GitHub" : k,
      cls,
      emoji: k === "remote" ? "📦" : os === "macos" ? "🍎" : "🪟",
    };
  });

  const padL = 220;
  const padR = 360;
  const padT = 56;
  const padB = 32;
  const laneH = 86;
  const dotR = 9;
  const xStep = 52;
  const W = padL + padR + Math.max(1, n - 1) * xStep + 80;
  const H = padT + lanes.length * laneH + padB;
  const xAt = (i: number) => padL + i * xStep;
  const yAt = (li: number) => padT + li * laneH + laneH / 2;

  const COLOR: Record<string, string> = {
    remote: "#6E40C9",
    mac: "#2563EB",
    win: "#0F766E",
  };
  const LANE_BG: Record<string, string> = {
    remote: "rgba(110,64,201,0.07)",
    mac: "rgba(37,99,235,0.07)",
    win: "rgba(15,118,110,0.07)",
  };

  const ancI = win.findIndex((c) => c.ancestor);

  return (
    <section className="gtl-graph">
      <header className="gtl-graph-head">
        <span className="mono">{graph.owner_repo}</span>
        <span className="gtl-sep">·</span>
        <span>{branch}</span>
        <span className="gtl-spacer" />
        <span className="gtl-hint">점에 hover · 클릭하면 아래에 상세 표시</span>
      </header>
      <div className="gtl-river">
        <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
          {/* Lane bands */}
          {lanes.map((l) => (
            <rect
              key={"band-" + l.key}
              x={padL - 14}
              y={yAt(l.idx) - laneH / 2 + 14}
              width={W - padL - padR + 28}
              height={laneH - 28}
              rx={14}
              fill={LANE_BG[l.cls]}
            />
          ))}
          {/* Label area divider */}
          <line
            x1={padL - 14}
            y1={padT - 10}
            x2={padL - 14}
            y2={H - padB + 6}
            stroke="#E4E4EA"
            strokeWidth={1}
          />
          {/* Lane labels */}
          {lanes.map((l) => {
            const y = yAt(l.idx);
            return (
              <g key={"lbl-" + l.key}>
                <foreignObject x={10} y={y - 18} width={36} height={36}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: "#FFFFFF",
                      border: "1px solid #E4E4EA",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 18,
                    }}
                  >
                    {l.emoji}
                  </div>
                </foreignObject>
                <text
                  x={52}
                  y={y + 5}
                  fill={COLOR[l.cls]}
                  fontSize={13.5}
                  fontWeight={700}
                  fontFamily='ui-monospace, "SF Mono", Menlo, monospace'
                >
                  {l.label}
                </text>
              </g>
            );
          })}
          {/* Per-lane connection lines */}
          {lanes.map((l) => {
            const xs: number[] = [];
            win.forEach((c, i) => {
              if (c.in?.[l.key]) xs.push(xAt(i));
            });
            if (xs.length < 2) return null;
            return (
              <line
                key={"conn-" + l.key}
                x1={Math.min(...xs)}
                y1={yAt(l.idx)}
                x2={Math.max(...xs)}
                y2={yAt(l.idx)}
                stroke={COLOR[l.cls]}
                strokeWidth={2.5}
                opacity={0.4}
              />
            );
          })}
          {/* Shared spine */}
          {win.map((c, i) => {
            if (lanes.length < 2 || !lanes.every((l) => c.in?.[l.key]))
              return null;
            const ys = lanes.map((l) => yAt(l.idx));
            return (
              <line
                key={"spine-" + c.sha}
                x1={xAt(i)}
                y1={Math.min(...ys)}
                x2={xAt(i)}
                y2={Math.max(...ys)}
                stroke="#B4B7BD"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                opacity={0.7}
              />
            );
          })}
          {/* LCA marker */}
          {ancI >= 0 && (
            <g>
              <line
                x1={xAt(ancI)}
                y1={padT - 18}
                x2={xAt(ancI)}
                y2={H - padB + 8}
                stroke="#D4A72C"
                strokeWidth={2}
                strokeDasharray="5 4"
                opacity={0.85}
              />
              <rect
                x={xAt(ancI) - 86}
                y={padT - 38}
                width={172}
                height={22}
                rx={6}
                fill="rgba(245,158,11,0.13)"
                stroke="rgba(212,167,44,0.4)"
                strokeWidth={1}
              />
              <text
                x={xAt(ancI)}
                y={padT - 22}
                textAnchor="middle"
                fill="#9a6700"
                fontSize={11.5}
                fontWeight={800}
                fontFamily='ui-monospace, "SF Mono", Menlo, monospace'
              >
                ⊥ 공통 조상 · {win[ancI].short}
              </text>
            </g>
          )}
          {/* Commit dots */}
          {win.flatMap((c, i) =>
            lanes
              .filter((l) => c.in?.[l.key])
              .map((l) => {
                const isTip = (c.tips || []).includes(l.key);
                const r = c.ancestor ? dotR + 3 : isTip ? dotR + 1 : dotR;
                const x = xAt(i);
                const y = yAt(l.idx);
                return (
                  <g key={`dot-${l.key}-${c.sha}`}>
                    {isTip && (
                      <circle
                        cx={x}
                        cy={y}
                        r={r + 4}
                        fill={COLOR[l.cls]}
                        opacity={0.18}
                      />
                    )}
                    {c.ancestor && (
                      <circle
                        cx={x}
                        cy={y}
                        r={r + 3}
                        fill="none"
                        stroke="#D4A72C"
                        strokeWidth={2}
                      />
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={r}
                      fill={COLOR[l.cls]}
                      stroke="#FFFFFF"
                      strokeWidth={2.5}
                      style={{ cursor: "pointer" }}
                      onClick={() => onSelectCommit(c)}
                    >
                      <title>
                        {c.short} · {c.msg} · {c.author} · {fmtRelative(c.date)}
                      </title>
                    </circle>
                  </g>
                );
              }),
          )}
          {/* Tip pills */}
          {lanes.map((l) => {
            let rightI = -1;
            for (let i = n - 1; i >= 0; i--) {
              if (win[i].in?.[l.key]) {
                rightI = i;
                break;
              }
            }
            if (rightI < 0) return null;
            const x = xAt(rightI) + dotR + 16;
            const y = yAt(l.idx);
            const refName =
              l.key === "remote"
                ? `origin/${graph.default_branch || "main"}`
                : `${l.key} HEAD`;
            const sha = win[rightI].short || "";
            const pillLabel = sha ? `${refName} · ${sha}` : refName;
            const w = Math.max(140, pillLabel.length * 8 + 36);
            return (
              <g key={"tip-" + l.key} transform={`translate(${x}, ${y - 15})`}>
                <rect width={w} height={30} rx={8} fill={COLOR[l.cls]} />
                <text
                  x={14}
                  y={20}
                  fill="#FFFFFF"
                  fontWeight={800}
                  fontSize={12}
                  fontFamily='ui-monospace, "SF Mono", Menlo, monospace'
                >
                  {pillLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="gtl-legend">
        <span className="gtl-legend-item">
          <span className="gtl-legend-dot" style={{ background: "#6E40C9" }} />
          원격 커밋
        </span>
        <span className="gtl-legend-item">
          <span className="gtl-legend-dot" style={{ background: "#2563EB" }} />
          Mac 로컬 커밋
        </span>
        <span className="gtl-legend-item">
          <span className="gtl-legend-dot" style={{ background: "#0F766E" }} />
          Win 로컬 커밋
        </span>
        <span className="gtl-legend-item">
          <svg width={22} height={6}>
            <line
              x1={0}
              y1={3}
              x2={22}
              y2={3}
              stroke="#B4B7BD"
              strokeWidth={2}
              strokeDasharray="2 4"
            />
          </svg>
          모든 호스트 공유
        </span>
        <span className="gtl-legend-item">
          <svg width={22} height={6}>
            <line
              x1={0}
              y1={3}
              x2={22}
              y2={3}
              stroke="#D4A72C"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          </svg>
          공통 조상 (LCA)
        </span>
      </div>
    </section>
  );
}

function TimelineDetailPanel({
  commit,
  graph,
}: {
  commit: RepoGraphCommit | null;
  graph: RepoGraph;
}) {
  return (
    <section className="gtl-detail">
      <header className="gtl-detail-head">
        <span aria-hidden>🎯</span>
        <span>선택된 커밋</span>
      </header>
      {commit ? (
        <DetailBody commit={commit} graph={graph} />
      ) : (
        <div className="gtl-detail-body empty">
          위 그래프의 점을 클릭하면 상세 정보가 표시돼요.
        </div>
      )}
    </section>
  );
}

function DetailBody({
  commit: c,
  graph,
}: {
  commit: RepoGraphCommit;
  graph: RepoGraph;
}) {
  const present = Object.entries(c.in ?? {})
    .filter(([_, v]) => v)
    .map(([k]) => k);
  const tipPills = (c.tips ?? []).map((t) => {
    const os = graph.hosts.find((h) => h.host === t)?.os || "";
    const cls = t === "remote" ? "remote" : os === "macos" ? "mac" : "win";
    const lbl =
      t === "remote"
        ? "origin/" + (graph.default_branch || "main")
        : `${t} HEAD`;
    return (
      <span key={t} className={`gtl-chip tip-${cls}`}>
        {lbl}
      </span>
    );
  });
  const srcPills = present.map((s) => {
    const os = graph.hosts.find((h) => h.host === s)?.os || "";
    const cls = s === "remote" ? "remote" : os === "macos" ? "mac" : "win";
    return (
      <span key={s} className={`gtl-src-pill ${cls}`}>
        {s}
      </span>
    );
  });
  return (
    <div className="gtl-detail-body">
      <div className="gtl-detail-row">
        <span className="gtl-detail-sha mono">{c.sha}</span>
        {c.ancestor && <span className="gtl-chip lca">⊥ 공통 조상</span>}
        {tipPills}
      </div>
      <div className="gtl-detail-msg">{c.msg || "(메시지 없음)"}</div>
      <div className="gtl-detail-meta">
        <span>{c.author}</span>
        <span className="gtl-sep">·</span>
        <span>{fmtRelative(c.date)}</span>
        <span className="gtl-spacer" />
        <span className="gtl-detail-sources">존재: {srcPills}</span>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────

function dirtyFileName(porcelain: string): string {
  const s = porcelain.trim();
  const i = s.indexOf(" ");
  return i < 0 ? s : s.slice(i + 1).trim();
}

function fmtRelative(iso: string | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return Math.floor(diff / 60) + "분 전";
  if (diff < 86400) return Math.floor(diff / 3600) + "시간 전";
  if (diff < 30 * 86400) return Math.floor(diff / 86400) + "일 전";
  return new Date(iso).toLocaleDateString();
}
