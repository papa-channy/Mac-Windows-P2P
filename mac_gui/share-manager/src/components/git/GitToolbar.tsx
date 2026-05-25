// GitToolbar — three action buttons above the L1 Repo Card grid, each
// with its own in-flight loading state:
//
//   1. Scan Now    — local disk walk + publish snapshot to the share
//   2. Sync Remote — hit GitHub API for every repo's owner/repo
//   3. Refresh All — re-read every share-side source (snapshots, logs,
//                    remote cache, token + ssh probes) without firing
//                    network calls
//
// Lucide icons throughout. Buttons disable themselves while busy and
// show a spinning Loader2 next to the label.

import { useState } from "react";
import { Search, Cloud, RefreshCw, Loader2 } from "lucide-react";
import { useGitStore } from "../../lib/gitStore";
import { useToast } from "../../lib/toast";

interface OpResult {
  op: "scan" | "sync" | "refresh";
  ok: boolean;
  message: string;
  at: number; // epoch ms
}

export function GitToolbar() {
  const store = useGitStore();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Inline "last result" survives the toast timeout — users who looked
  // away during the spinner can still see what happened.
  const [last, setLast] = useState<OpResult | null>(null);

  const record = (op: OpResult["op"], ok: boolean, message: string) => {
    setLast({ op, ok, message, at: Date.now() });
  };

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const n = await store.scanAndPublish();
      const msg = `Scanned and published ${n} repo${n === 1 ? "" : "s"}`;
      toast(msg, "success");
      record("scan", true, msg);
    } catch (e) {
      const msg = `Scan failed: ${e}`;
      toast(msg, "error");
      record("scan", false, String(e));
    } finally {
      setScanning(false);
    }
  };

  const syncRemote = async () => {
    if (fetching) return;
    const ownerRepos = collectOwnerRepos(store);
    if (ownerRepos.length === 0) {
      const msg = "No repos to fetch — run Scan Now first";
      toast(msg, "error");
      record("sync", false, msg);
      return;
    }
    if (!store.hasToken) {
      const msg = "PAT missing — add one in Settings → Git";
      toast(msg, "error");
      record("sync", false, msg);
      return;
    }
    setFetching(true);
    try {
      const states = await store.fetchRemote(ownerRepos);
      const msg = `Synced ${states.length} repos from GitHub`;
      toast(msg, "success");
      record("sync", true, msg);
    } catch (e) {
      const msg = `Remote sync failed: ${e}`;
      toast(msg, "error");
      record("sync", false, String(e));
    } finally {
      setFetching(false);
    }
  };

  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await store.refresh();
      record("refresh", true, "Re-read snapshots + cache");
    } catch (e) {
      record("refresh", false, String(e));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="git-toolbar-wrap">
      <div className="git-toolbar">
        <ToolbarButton
          kind="primary"
          icon={scanning ? <Loader2 size={14} className="git-tb-spin" /> : <Search size={14} />}
          label={scanning ? "Scanning…" : "Scan Now"}
          title="Walk local roots (~/Developer, ~/Projects, …) and publish this host's snapshot"
          onClick={scan}
          disabled={scanning || store.loading}
        />
        <ToolbarButton
          kind="primary"
          icon={fetching ? <Loader2 size={14} className="git-tb-spin" /> : <Cloud size={14} />}
          label={fetching ? "Syncing…" : "Sync Remote"}
          title="Fetch default branch / branches / open PRs for every known repo via GitHub API"
          onClick={syncRemote}
          disabled={fetching || store.loading}
        />
        <ToolbarButton
          kind="ghost"
          icon={refreshing ? <Loader2 size={14} className="git-tb-spin" /> : <RefreshCw size={14} />}
          label={refreshing ? "Refreshing…" : "Refresh All"}
          title="Re-read every snapshot + cache on the share without firing network calls"
          onClick={refreshAll}
          disabled={refreshing || store.loading}
        />
      </div>
      {last && (
        <div className={"git-toolbar-result " + (last.ok ? "ok" : "err")}>
          <span className="git-tb-result-mark">{last.ok ? "✓" : "✗"}</span>
          <span className="git-tb-result-op">{labelFor(last.op)}</span>
          <span className="git-tb-result-msg">{last.message}</span>
          <span className="git-tb-result-time">{fmtSince(last.at)}</span>
        </div>
      )}
    </div>
  );
}

function labelFor(op: OpResult["op"]): string {
  switch (op) {
    case "scan":    return "Scan Now";
    case "sync":    return "Sync Remote";
    case "refresh": return "Refresh All";
  }
}

function fmtSince(at: number): string {
  const sec = Math.floor((Date.now() - at) / 1000);
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return new Date(at).toLocaleTimeString();
}

function ToolbarButton({
  kind,
  icon,
  label,
  title,
  onClick,
  disabled,
}: {
  kind: "primary" | "ghost";
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className={"git-toolbar-btn" + (kind === "ghost" ? " ghost" : "")}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <span className="git-tb-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function collectOwnerRepos(store: ReturnType<typeof useGitStore>): string[] {
  const seen = new Set<string>();
  for (const snap of store.snapshots) {
    for (const r of snap.repos) {
      if (r.owner_repo) seen.add(r.owner_repo);
    }
  }
  return [...seen];
}
