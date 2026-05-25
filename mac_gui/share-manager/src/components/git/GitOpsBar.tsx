// GitOpsBar — Mac-side interactive git ops inside the L2 detail modal.
//
// Five buttons, each shelling out to `git -C <repo> <op>`:
//   Fetch / Pull / Push / Stash / Stash Pop
//
// Each button has its own in-flight loading state + Loader2 spinner.
// Result toasts surface git's stderr verbatim so failures (auth,
// conflicts, no upstream) are immediately visible. Pull uses
// --ff-only — refuses to merge automatically when the branch has
// diverged.
//
// Win-side ops aren't exposed (we can't reach the Windows machine).
// Narrative actions that recommend "Win 에서 git push" stay as the
// human guidance in StatusChip.

import { useState } from "react";
import {
  Download,
  Upload,
  RefreshCw,
  Package,
  PackageOpen,
  Loader2,
} from "lucide-react";
import { api, type GitOpResult } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { useGitStore } from "../../lib/gitStore";

type OpId = "fetch" | "pull" | "push" | "stash" | "stash-pop";

const OPS: { id: OpId; label: string; Icon: typeof Download; title: string }[] = [
  { id: "fetch",     label: "Fetch",     Icon: RefreshCw, title: "git fetch --all --prune" },
  { id: "pull",      label: "Pull",      Icon: Download,  title: "git pull --ff-only (merge 발생 시 거부)" },
  { id: "push",      label: "Push",      Icon: Upload,    title: "git push (upstream 으로)" },
  { id: "stash",     label: "Stash",     Icon: Package,   title: "git stash push -u (untracked 포함)" },
  { id: "stash-pop", label: "Stash Pop", Icon: PackageOpen, title: "git stash pop (가장 최근 stash 복원)" },
];

interface Props {
  /** Local repo path on this Mac. If null, the bar is hidden (this
   *  repo doesn't exist on the Mac side). */
  repoPath: string | null;
}

export function GitOpsBar({ repoPath }: Props) {
  const [busy, setBusy] = useState<OpId | null>(null);
  const toast = useToast();
  const store = useGitStore();

  if (!repoPath) {
    return (
      <div className="git-ops-bar">
        <span className="git-ops-disabled">
          이 머신에 이 레포가 없어요 — git ops 비활성화
        </span>
      </div>
    );
  }

  const run = async (op: OpId, fn: () => Promise<GitOpResult>) => {
    if (busy) return;
    setBusy(op);
    try {
      const r = await fn();
      const tail = r.stderr.trim().split("\n").slice(-2).join(" · ") || r.stdout.trim().slice(0, 120);
      if (r.ok) {
        toast(`✓ git ${op} 완료${tail ? ` · ${tail}` : ""}`, "success");
        // Re-publish snapshot so the dashboard reflects the new state
        // immediately (HEAD moved, dirty cleared, etc).
        store.scanAndPublish().catch(() => void 0);
      } else {
        toast(`✗ git ${op} 실패 (exit ${r.exit_code ?? "?"}): ${tail}`, "error");
      }
    } catch (e) {
      toast(`✗ git ${op} 호출 실패: ${e}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const handler = (op: OpId): (() => Promise<GitOpResult>) => {
    switch (op) {
      case "fetch":     return () => api.git.opFetch(repoPath);
      case "pull":      return () => api.git.opPull(repoPath);
      case "push":      return () => api.git.opPush(repoPath);
      case "stash":     return () => api.git.opStash(repoPath);
      case "stash-pop": return () => api.git.opStashPop(repoPath);
    }
  };

  return (
    <div className="git-ops-bar">
      <span className="git-ops-label">Mac ops</span>
      {OPS.map(({ id, label, Icon, title }) => {
        const active = busy === id;
        return (
          <button
            key={id}
            type="button"
            className={"git-ops-btn" + (active ? " busy" : "")}
            disabled={busy !== null}
            onClick={() => run(id, handler(id))}
            title={title}
          >
            {active ? <Loader2 size={13} className="git-tb-spin" /> : <Icon size={13} />}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
