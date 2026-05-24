// Tests for computeGitNarrative — the §18.6 verdict-action table
// translated into a pure function. Every row in the table is exercised
// here, plus a few edge cases (single-host, no remote, behind-only).

import { describe, it, expect } from "vitest";
import {
  computeGitNarrative,
  worstVerdict,
  tallyVerdicts,
} from "../../src/lib/computeGitNarrative";
import type { RepoGraph } from "../../src/lib/api";

const baseGraph = (overrides: Partial<RepoGraph> = {}): RepoGraph => ({
  owner_repo: "foo/bar",
  default_branch: "main",
  branches: ["main"],
  hosts: [
    { host: "mac1", os: "macos" },
    { host: "win1", os: "windows" },
  ],
  has_token: true,
  per_branch: {
    main: {
      commits: [],
      pointers: {},
      common_ancestor: null,
      summary: {
        mac1: { ahead: 0, behind: 0, has_remote: true },
        win1: { ahead: 0, behind: 0, has_remote: true },
      },
    },
  },
  ...overrides,
});

describe("computeGitNarrative — §18.6 verdict table", () => {
  it("all in sync → synced", () => {
    const n = computeGitNarrative(baseGraph());
    expect(n.verdict).toBe("synced");
    expect(n.headline).toMatch(/일치/);
  });

  it("mac ahead only → warn + push/pull action", () => {
    const g = baseGraph();
    g.per_branch.main.summary.mac1 = { ahead: 2, behind: 0, has_remote: true };
    const n = computeGitNarrative(g);
    expect(n.verdict).toBe("warn");
    expect(n.headline).toContain("Mac");
    expect(n.headline).toContain("2커밋");
    expect(n.action).toMatch(/push.*pull/);
  });

  it("win ahead only → warn", () => {
    const g = baseGraph();
    g.per_branch.main.summary.win1 = { ahead: 3, behind: 0, has_remote: true };
    const n = computeGitNarrative(g);
    expect(n.verdict).toBe("warn");
    expect(n.headline).toContain("Win");
    expect(n.headline).toContain("3커밋");
  });

  it("both ahead → danger", () => {
    const g = baseGraph();
    g.per_branch.main.summary.mac1 = { ahead: 1, behind: 0, has_remote: true };
    g.per_branch.main.summary.win1 = { ahead: 2, behind: 0, has_remote: true };
    const n = computeGitNarrative(g);
    expect(n.verdict).toBe("danger");
    expect(n.headline).toMatch(/양쪽 발산.*Mac.*1.*Win.*2/);
  });

  it("behind on one side → warn + pull recommendation", () => {
    const g = baseGraph();
    g.per_branch.main.summary.mac1 = { ahead: 0, behind: 2, has_remote: true };
    const n = computeGitNarrative(g);
    expect(n.verdict).toBe("warn");
    expect(n.headline).toContain("뒤처짐");
    expect(n.action).toContain("pull");
  });

  it("no token → partial", () => {
    const g = baseGraph({ has_token: false });
    const n = computeGitNarrative(g);
    expect(n.verdict).toBe("partial");
    expect(n.action).toMatch(/PAT/);
  });

  it("no remote on any host → partial", () => {
    const g = baseGraph();
    g.per_branch.main.summary.mac1.has_remote = false;
    g.per_branch.main.summary.win1.has_remote = false;
    const n = computeGitNarrative(g);
    expect(n.verdict).toBe("partial");
  });

  it("branch not found falls back to partial empty narrative", () => {
    const n = computeGitNarrative(baseGraph(), "nonexistent-branch");
    expect(n.verdict).toBe("partial");
    expect(n.headline).toBe("원격 데이터 없음");
  });

  it("missing default branch picks the first available", () => {
    const g = baseGraph({
      default_branch: "",
      branches: ["develop"],
      per_branch: {
        develop: {
          commits: [],
          pointers: {},
          common_ancestor: null,
          summary: {
            mac1: { ahead: 0, behind: 0, has_remote: true },
            win1: { ahead: 0, behind: 0, has_remote: true },
          },
        },
      },
    });
    const n = computeGitNarrative(g);
    expect(n.branch).toBe("develop");
    expect(n.verdict).toBe("synced");
  });
});

describe("worstVerdict + tallyVerdicts helpers", () => {
  const baseN = {
    headline: "",
    action: "",
    branch: "main",
    commonAncestor: null,
  };

  it("worst picks danger over partial over warn", () => {
    expect(
      worstVerdict([
        { ...baseN, verdict: "synced" as const },
        { ...baseN, verdict: "warn" as const },
        { ...baseN, verdict: "danger" as const },
        { ...baseN, verdict: "partial" as const },
      ]),
    ).toBe("danger");
  });

  it("worst on all synced returns synced", () => {
    expect(
      worstVerdict([
        { ...baseN, verdict: "synced" as const },
        { ...baseN, verdict: "synced" as const },
      ]),
    ).toBe("synced");
  });

  it("tally — atRisk counts danger + partial", () => {
    const t = tallyVerdicts([
      { ...baseN, verdict: "synced" as const },
      { ...baseN, verdict: "warn" as const },
      { ...baseN, verdict: "danger" as const },
      { ...baseN, verdict: "partial" as const },
    ]);
    expect(t.total).toBe(4);
    expect(t.synced).toBe(1);
    expect(t.atRisk).toBe(2);
  });
});
