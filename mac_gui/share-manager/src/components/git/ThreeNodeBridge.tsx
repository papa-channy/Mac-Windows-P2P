// ThreeNodeBridge — MAC ── ORIGIN ── WIN horizontal node row inside each
// L1 RepoCard. Lucide icons (Apple / Github / AppWindow) replace the
// emoji from the first cut so the visual is consistent with the rest of
// the chrome.

import { Apple, CheckCircle2 } from "lucide-react";
import { GithubBrand, WindowsBrand } from "./BrandIcons";
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

function NodeIcon({ kind }: { kind: NodeKind }) {
  if (kind === "mac") return <Apple size={18} fill="currentColor" strokeWidth={0} />;
  if (kind === "remote") return <GithubBrand size={18} />;
  return <WindowsBrand size={18} />;
}

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
        <CheckCircle2 size={11} />
        <span>Clean</span>
      </span>
    );
  }
  return (
    <div className={`gn gn-${kind}${dim ? " off" : ""}`}>
      <div className="gn-icon">
        <NodeIcon kind={kind} />
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
