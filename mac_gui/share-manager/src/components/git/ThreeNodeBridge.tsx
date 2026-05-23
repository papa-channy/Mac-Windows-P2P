// ThreeNodeBridge — 🍎 MAC ── 📦 ORIGIN ── 🪟 WIN horizontal node row
// rendered inside each L1 RepoCard. Mirror of windows_gui/.../app.js
// gitNodeBlock + .git-card-bridge layout.
//
// Each node is a tile (icon + LED) + label + a third row that surfaces
// either dirty count / origin SHA / "Clean" / "없음".

import type { RepoStatus, RemoteRepoState } from "../../lib/api";

export type NodeKind = "mac" | "remote" | "win";

interface Props {
  mac: RepoStatus | null;
  win: RepoStatus | null;
  remote: RemoteRepoState | null;
}

export function ThreeNodeBridge({ mac, win, remote }: Props) {
  return (
    <div className="git-card-bridge">
      <NodeBlock kind="mac" data={mac} dirty={mac?.dirty ?? null} />
      <div className="gn-link" />
      <NodeBlock
        kind="remote"
        data={remote ? { head: short(remote.default_sha) } : null}
        dirty={null}
      />
      <div className="gn-link" />
      <NodeBlock kind="win" data={win} dirty={win?.dirty ?? null} />
      <span className="git-card-chev">›</span>
    </div>
  );
}

interface NodeBlockProps {
  kind: NodeKind;
  data: { head?: string; dirty?: number | null } | null;
  dirty: number | null;
}

const LABELS: Record<NodeKind, string> = {
  mac: "MAC",
  remote: "ORIGIN",
  win: "WIN",
};

const EMOJI: Record<NodeKind, string> = {
  mac: "🍎",
  remote: "📦",
  win: "🪟",
};

function NodeBlock({ kind, data, dirty }: NodeBlockProps) {
  const dim = !data;
  let third: JSX.Element;
  if (kind === "remote") {
    third = <span className="gn-mono">{data?.head ?? "—"}</span>;
  } else if (dim) {
    third = <span className="gn-mute">없음</span>;
  } else if (dirty !== null && dirty > 0) {
    third = <span className="gn-dirty">{dirty} dirty</span>;
  } else {
    third = (
      <span className="gn-clean">
        <span aria-hidden>✓</span>
        <span>Clean</span>
      </span>
    );
  }
  return (
    <div className={`gn gn-${kind}${dim ? " off" : ""}`}>
      <div className="gn-icon">
        <span aria-hidden>{EMOJI[kind]}</span>
        <span className="gn-led" />
      </div>
      <div className="gn-label">{LABELS[kind]}</div>
      <div className="gn-third">{third}</div>
    </div>
  );
}

function short(sha: string | undefined | null): string {
  if (!sha) return "—";
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}
