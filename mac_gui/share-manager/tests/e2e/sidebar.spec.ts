// Sidebar shape + interactions. The functional contract:
//   - 6 pinned actions always visible (Fast Forward / Notes / Clipboard
//     / Git Status / Refresh / Settings)
//   - In/Out group headers are toggle buttons (default collapsed)
//   - Log Hub group header is a toggle (default collapsed)
//   - Clicking a pinned button changes the active state
//
// Runs against the Vite dev server with a stubbed Tauri invoke layer
// — no real share mount required.

import { test, expect } from "@playwright/test";
import { installMockTauri } from "./fixtures/mock-tauri";

test.beforeEach(async ({ page }) => {
  await installMockTauri(page);
  await page.goto("/");
});

test("renders all 6 pinned actions", async ({ page }) => {
  for (const label of [
    "Fast Forward",
    "Notes",
    "Clipboard",
    "Git Status",
    "Refresh",
    "Settings",
  ]) {
    await expect(page.locator(".nav-pin", { hasText: label })).toBeVisible();
  }
});

test("transfer group categories are collapsed by default", async ({ page }) => {
  const header = page.locator(".nav-group-toggle", { hasText: "In - from Windows" });
  await expect(header).toBeVisible();
  // The All row is always visible
  const allRow = page.locator(".nav-group").filter({ has: header }).locator(".nav-item").first();
  await expect(allRow).toBeVisible();
  // Category rows (Documents/Data/...) should NOT be visible initially
  await expect(page.locator(".nav-item.is-empty")).toHaveCount(0);
});

test("clicking In group header expands categories", async ({ page }) => {
  await page.locator(".nav-group-toggle", { hasText: "In - from Windows" }).click();
  // At least one category should now be visible (counts are 0 so they
  // all have .is-empty)
  await expect(page.locator(".nav-item.is-empty").first()).toBeVisible({ timeout: 2000 });
  // Click again to collapse
  await page.locator(".nav-group-toggle", { hasText: "In - from Windows" }).click();
  await expect(page.locator(".nav-item.is-empty")).toHaveCount(0);
});

test("Log Hub is collapsed by default and expands on click", async ({ page }) => {
  const logHeader = page.locator(".nav-group-toggle", { hasText: "Log Hub" });
  await expect(logHeader).toBeVisible();
  // Log Hub sub-items hidden initially
  await expect(page.locator(".nav-item", { hasText: "Sent" })).toHaveCount(0);
  // Expand
  await logHeader.click();
  await expect(page.locator(".nav-item", { hasText: "Sent" })).toBeVisible();
  await expect(page.locator(".nav-item", { hasText: "Received" })).toBeVisible();
  await expect(page.locator(".nav-item", { hasText: "Archive" })).toBeVisible();
});

test("clicking pinned action toggles its active state", async ({ page }) => {
  const notes = page.locator(".nav-pin", { hasText: "Notes" });
  await notes.click();
  await expect(notes).toHaveClass(/active/);
  // Then click Clipboard — Notes should lose active
  await page.locator(".nav-pin", { hasText: "Clipboard" }).click();
  await expect(notes).not.toHaveClass(/active/);
});
