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

export function GitToolbar() {
  const store = useGitStore();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const n = await store.scanAndPublish();
      toast(`Scanned and published ${n} repo${n === 1 ? "" : "s"}`, "success");
    } catch (e) {
      toast(`Scan failed: ${e}`, "error");
    } finally {
      setScanning(false);
    }
  };

  const syncRemote = async () => {
    if (fetching) return;
    const ownerRepos = collectOwnerRepos(store);
    if (ownerRepos.length === 0) {
      toast("No repos to fetch — run Scan Now first", "error");
      return;
    }
    if (!store.hasToken) {
      toast("PAT missing — add one in Settings → Git", "error");
      return;
    }
    setFetching(true);
    try {
      const states = await store.fetchRemote(ownerRepos);
      toast(`Synced ${states.length} repos from GitHub`, "success");
    } catch (e) {
      toast(`Remote sync failed: ${e}`, "error");
    } finally {
      setFetching(false);
    }
  };

  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await store.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
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
  );
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
