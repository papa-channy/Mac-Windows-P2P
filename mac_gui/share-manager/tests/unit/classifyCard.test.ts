// Tests for classifyCard — the L1 RepoCard verdict priority:
// conflict > partial > diverged > dirty > synced.

import { describe, it, expect } from "vitest";
import { classifyCard, type RepoCardSummary } from "../../src/components/git/RepoCard";
import type { RepoStatus } from "../../src/lib/api";

const repo = (overrides: Partial<RepoStatus & { os: string }>): RepoStatus & { os: string } => ({
  owner_repo: "foo/bar",
  path: "/x",
  branch: "main",
  head: "deadbeefcafebabe",
  upstream: "origin/main",
  dirty: 0,
  dirty_files: [],
  unpushed: 0,
  ahead: 0,
  behind: 0,
  stash: 0,
  last_commit: null,
  remote_url: null,
  os: "macos",
  ...overrides,
});

const summary = (byHost: Record<string, RepoStatus & { os: string }>): RepoCardSummary => ({
  ownerRepo: "foo/bar",
  label: "foo/bar",
  byHost,
  remote: null,
});

describe("classifyCard", () => {
  it("single host → partial", () => {
    expect(classifyCard(summary({ mac1: repo({}) })).kind).toBe("partial");
  });

  it("two hosts identical HEAD + clean → synced", () => {
    expect(
      classifyCard(
        summary({
          mac1: repo({ os: "macos" }),
          win1: repo({ os: "windows" }),
        }),
      ).kind,
    ).toBe("synced");
  });

  it("two hosts with different HEAD → diverged", () => {
    expect(
      classifyCard(
        summary({
          mac1: repo({ os: "macos", head: "aaa" }),
          win1: repo({ os: "windows", head: "bbb" }),
        }),
      ).kind,
    ).toBe("diverged");
  });

  it("same HEAD but dirty files → dirty", () => {
    expect(
      classifyCard(
        summary({
          mac1: repo({ os: "macos", dirty: 1, dirty_files: [" M file.txt"] }),
          win1: repo({ os: "windows" }),
        }),
      ).kind,
    ).toBe("dirty");
  });

  it("same file dirty on both OSes → conflict", () => {
    const r = classifyCard(
      summary({
        mac1: repo({ os: "macos", dirty: 1, dirty_files: [" M shared.txt"] }),
        win1: repo({ os: "windows", dirty: 1, dirty_files: [" M shared.txt"] }),
      }),
    );
    expect(r.kind).toBe("conflict");
    expect(r.overlaps).toEqual(["shared.txt"]);
  });

  it("conflict beats diverged", () => {
    // Different HEADs AND overlapping dirty file → conflict wins
    const r = classifyCard(
      summary({
        mac1: repo({ os: "macos", head: "aaa", dirty: 1, dirty_files: [" M x.ts"] }),
        win1: repo({ os: "windows", head: "bbb", dirty: 1, dirty_files: [" M x.ts"] }),
      }),
    );
    expect(r.kind).toBe("conflict");
  });

  it("porcelain ?? untracked also detected", () => {
    const r = classifyCard(
      summary({
        mac1: repo({ os: "macos", dirty: 1, dirty_files: ["?? scratch.md"] }),
        win1: repo({ os: "windows", dirty: 1, dirty_files: ["?? scratch.md"] }),
      }),
    );
    expect(r.kind).toBe("conflict");
    expect(r.overlaps).toContain("scratch.md");
  });
});
