// computeGitNarrative.ts — T1.3 verdict-action calculator for the
// Sync Timeline. Source of truth = WINDOWS_PARITY_BRIEF §18.6 +
// ADR-0004 (Sync Timeline narrative).
//
// Given the merged RepoGraph for a single repo+branch, compute the
// short "what / why / how" narrative the Status Summary panel renders.
// All cross-OS rules live in this one function so the React layer in
// Wave C can render purely declaratively.

import type { RepoGraph, RepoGraphBranch } from "./api";

export type Verdict = "synced" | "warn" | "danger" | "partial";

export interface GitNarrative {
  verdict: Verdict;
  /** One-sentence headline ("Mac이 origin보다 1커밋 앞섬") */
  headline: string;
  /** Recommended next action ("Mac에서 git push 후 Win에서 git pull") */
  action: string;
  /** branch name this narrative covers */
  branch: string;
  /** common ancestor SHA across all sources (null = beyond the 50-commit window) */
  commonAncestor: string | null;
}

interface HostSummary {
  host: string;
  os: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  /** present in the graph at all (might still be 0/0 vs remote) */
  inGraph: boolean;
}

function classifyHost(os: string): "mac" | "win" | "other" {
  const o = os.toLowerCase();
  if (o.includes("mac") || o.includes("darwin")) return "mac";
  if (o.includes("win")) return "win";
  return "other";
}

/**
 * Compute a narrative for one (graph, branch) pair. The default branch
 * is chosen when `branch` is omitted. Returns `partial` when there's not
 * enough data to render a confident verdict.
 */
export function computeGitNarrative(
  graph: RepoGraph,
  branch?: string,
): GitNarrative {
  const b = branch ?? graph.default_branch ?? graph.branches[0] ?? "main";
  const empty: GitNarrative = {
    verdict: "partial",
    headline: "원격 데이터 없음",
    action: "원격 동기화 / 스캔 필요",
    branch: b,
    commonAncestor: null,
  };

  const branchData: RepoGraphBranch | undefined = graph.per_branch[b];
  if (!branchData) return empty;

  // Gather per-host summary in a stable order: macs first, then wins,
  // then others. Within a class, sort by host name.
  const hosts: HostSummary[] = graph.hosts
    .map((h) => {
      const s = branchData.summary[h.host];
      return {
        host: h.host,
        os: h.os,
        ahead: s?.ahead ?? 0,
        behind: s?.behind ?? 0,
        hasRemote: s?.has_remote ?? false,
        inGraph: s !== undefined,
      };
    })
    .sort((a, b2) => {
      const ca = classifyHost(a.os);
      const cb = classifyHost(b2.os);
      const rank = (c: typeof ca) => (c === "mac" ? 0 : c === "win" ? 1 : 2);
      if (rank(ca) !== rank(cb)) return rank(ca) - rank(cb);
      return a.host.localeCompare(b2.host);
    });

  const macs = hosts.filter((h) => classifyHost(h.os) === "mac");
  const wins = hosts.filter((h) => classifyHost(h.os) === "win");
  const hasRemote = hosts.some((h) => h.hasRemote);

  // Rule: token missing or remote never fetched
  if (!hasRemote || !graph.has_token) {
    return {
      verdict: "partial",
      headline: "원격 데이터 없음",
      action: graph.has_token
        ? "원격 fetch 시도 (GitHub API)"
        : "GitHub PAT 등록 후 다시 스캔",
      branch: b,
      commonAncestor: branchData.common_ancestor,
    };
  }

  const macAhead = macs.reduce((s, h) => s + h.ahead, 0);
  const macBehind = macs.reduce((s, h) => s + h.behind, 0);
  const winAhead = wins.reduce((s, h) => s + h.ahead, 0);
  const winBehind = wins.reduce((s, h) => s + h.behind, 0);

  // 1) Both sides have unpushed commits → divergence (danger)
  if (macAhead > 0 && winAhead > 0) {
    return {
      verdict: "danger",
      headline: `양쪽 발산 · Mac ↑${macAhead} / Win ↑${winAhead}`,
      action: "양쪽 미푸시 — 통합 결정 후 한쪽씩 push",
      branch: b,
      commonAncestor: branchData.common_ancestor,
    };
  }
  // 2) Mac ahead only
  if (macAhead > 0 && winAhead === 0) {
    return {
      verdict: "warn",
      headline: `Mac이 origin보다 ${macAhead}커밋 앞섬`,
      action: "Mac에서 git push 후 Win에서 git pull",
      branch: b,
      commonAncestor: branchData.common_ancestor,
    };
  }
  // 3) Win ahead only
  if (winAhead > 0 && macAhead === 0) {
    return {
      verdict: "warn",
      headline: `Win이 origin보다 ${winAhead}커밋 앞섬`,
      action: "Win에서 git push 후 Mac에서 git pull",
      branch: b,
      commonAncestor: branchData.common_ancestor,
    };
  }
  // 4) Some host is behind
  if (macBehind > 0 || winBehind > 0) {
    const lagging = hosts.filter((h) => h.behind > 0).map((h) => h.host);
    return {
      verdict: "warn",
      headline: `뒤처짐 · ${lagging.join(", ")}`,
      action: `${lagging.join(", ")}에서 git pull 권장`,
      branch: b,
      commonAncestor: branchData.common_ancestor,
    };
  }
  // 5) All in sync
  return {
    verdict: "synced",
    headline: "모든 호스트가 origin과 일치",
    action: "추가 작업 필요 없음",
    branch: b,
    commonAncestor: branchData.common_ancestor,
  };
}

/**
 * Walk over each repo in `graphs` and pick the worst verdict. Used by
 * the L1 dashboard's "충돌 위험" hero card without re-walking on every
 * render.
 */
export function worstVerdict(narratives: GitNarrative[]): Verdict {
  const order: Verdict[] = ["synced", "partial", "warn", "danger"];
  let worst: Verdict = "synced";
  for (const n of narratives) {
    if (order.indexOf(n.verdict) > order.indexOf(worst)) worst = n.verdict;
  }
  return worst;
}

/**
 * Tally verdict counts for the L1 hero stats row (total / synced /
 * danger). The brief defines the danger card as "충돌 위험" — both
 * `danger` and `partial` count toward it because partial means we can't
 * confirm safety.
 */
export function tallyVerdicts(narratives: GitNarrative[]): {
  total: number;
  synced: number;
  atRisk: number;
} {
  let synced = 0;
  let atRisk = 0;
  for (const n of narratives) {
    if (n.verdict === "synced") synced += 1;
    if (n.verdict === "danger" || n.verdict === "partial") atRisk += 1;
  }
  return { total: narratives.length, synced, atRisk };
}
