// Git Status dashboard with seeded snapshot data — exercises the
// classifyCard pipeline + ThreeNodeBridge + RepoCard click → detail
// modal. Confirms layout doesn't collapse / titles don't truncate
// vertically.

import { test, expect } from "@playwright/test";
import { installMockTauri } from "./fixtures/mock-tauri";

const seedSnapshot = {
  schema_version: 1,
  host: "test-mac",
  os: "macos",
  scanned_at: new Date().toISOString(),
  repos: [
    {
      owner_repo: "papa-channy/Mac-Windows-P2P",
      path: "/Users/test/dev/repo",
      branch: "main",
      head: "deadbeefcafebabe1234567890abcdef",
      upstream: "origin/main",
      dirty: 0,
      dirty_files: [],
      unpushed: 0,
      ahead: 0,
      behind: 0,
      stash: 0,
      last_commit: null,
      remote_url: "https://github.com/papa-channy/Mac-Windows-P2P.git",
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await installMockTauri(page, {
    list_git_status: [seedSnapshot],
    git_has_token: { has_token: true },
  });
  await page.goto("/");
});

test("Git sidebar pin opens the dashboard", async ({ page }) => {
  await page.locator(".nav-pin", { hasText: "Git Status" }).click();
  await expect(page.locator("h1", { hasText: "Git Status" })).toBeVisible();
});

test("hero stats reflect seeded snapshot count", async ({ page }) => {
  await page.locator(".nav-pin", { hasText: "Git Status" }).click();
  // 전체 레포지토리 hero card shows "1"
  const heroNum = page.locator(".git-hero-card").first().locator(".ghc-num");
  await expect(heroNum).toHaveText("1");
});

test("RepoCard click opens detail modal", async ({ page }) => {
  await page.locator(".nav-pin", { hasText: "Git Status" }).click();
  const card = page.locator(".git-card").first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator(".git-detail-shell")).toBeVisible({ timeout: 2000 });
  await expect(page.locator(".git-detail-title")).toHaveText(/papa-channy.Mac-Windows-P2P/);
});

test("conflict + dirty + diverged cards all render same layout when seeded", async ({ page }) => {
  await installMockTauri(page, {
    list_git_status: [
      {
        schema_version: 1,
        host: "test-mac",
        os: "macos",
        scanned_at: new Date().toISOString(),
        repos: [
          { ...seedSnapshot.repos[0], owner_repo: "foo/conflict", dirty: 1, dirty_files: [" M overlap.ts"] },
          { ...seedSnapshot.repos[0], owner_repo: "foo/clean" },
        ],
      },
      {
        schema_version: 1,
        host: "test-win",
        os: "windows",
        scanned_at: new Date().toISOString(),
        repos: [
          { ...seedSnapshot.repos[0], owner_repo: "foo/conflict", dirty: 1, dirty_files: [" M overlap.ts"] },
          { ...seedSnapshot.repos[0], owner_repo: "foo/clean" },
        ],
      },
    ],
  });
  await page.goto("/");
  await page.locator(".nav-pin", { hasText: "Git Status" }).click();

  const conflictCard = page.locator(".git-card-conflict");
  const syncedCard = page.locator(".git-card-synced");
  await expect(conflictCard).toBeVisible();
  await expect(syncedCard).toBeVisible();

  // Heights should be equal — the bug we just fixed made conflict
  // cards collapse to a single row.
  const conflictBox = await conflictCard.boundingBox();
  const syncedBox = await syncedCard.boundingBox();
  expect(conflictBox).not.toBeNull();
  expect(syncedBox).not.toBeNull();
  // allow 4px slack for sub-pixel rounding
  expect(Math.abs((conflictBox!.height) - (syncedBox!.height))).toBeLessThan(4);
});
