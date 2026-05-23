// nav.ts — sidebar navigation data shared by Sidebar.tsx and panels.
//
// Mirror of windows_gui/share-manager/src/app.js NAV_GROUPS + LOG_CATEGORIES
// (post-7358b1a casing/labels). One source of truth so re-arranging on
// either side keeps both consistent.

import type { Direction, StateKey } from "./api";

export interface NavGroup {
  id: string;
  /** sidebar header text — kept in natural case (no CSS uppercasing) */
  title: string;
  emoji: string;
  direction: Direction;
  state: StateKey;
}

/**
 * Transfer groups on the Mac side (mirror of Windows side, swapped):
 *   - inbox     receive from Windows  (direction = windows_to_mac, state = ready)
 *   - outbox    files we sent         (direction = mac_to_windows, state = ready)
 *   - archive   archived after open   (direction = windows_to_mac, state = received)
 *
 * "In - from Windows" / "Out - to Windows" mirrors the Windows side's
 * "In - from Mac" / "Out - to Mac" naming (commit 7358b1a).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "inbox",
    title: "In - from Windows",
    emoji: "📥",
    direction: "windows_to_mac",
    state: "ready",
  },
  {
    id: "outbox",
    title: "Out - to Windows",
    emoji: "📤",
    direction: "mac_to_windows",
    state: "ready",
  },
  {
    id: "received",
    title: "Archive",
    emoji: "🗂",
    direction: "windows_to_mac",
    state: "received",
  },
];

/**
 * Log hub sub-items rendered directly below the Out group. Real backing
 * views land in T4 (Wave B) — until then the panel is a placeholder that
 * shows "coming in Wave B" so users (and the e2e tests) can navigate
 * without crashes.
 *
 * IDs and subtitles mirror windows_gui/share-manager/src/app.js
 * LOG_CATEGORIES verbatim so Mac and Windows render identical labels.
 */
export interface LogCategory {
  id: string;
  emoji: string;
  label: string;
  subtitle: string;
}

export const LOG_CATEGORIES: LogCategory[] = [
  { id: "send",       emoji: "📤", label: "Sent",              subtitle: "Mac → Windows 송신 기록" },
  { id: "recv",       emoji: "📥", label: "Received",          subtitle: "Windows → Mac 수신 + 무결성 검증 기록" },
  { id: "error",      emoji: "⚠",  label: "Errors",            subtitle: "송신/검증 실패 기록" },
  { id: "compressed", emoji: "🖼", label: "Compressed images", subtitle: "30일 경과 후 압축 보관된 클립보드 이미지" },
  { id: "worklog",    emoji: "📝", label: "Worklog",           subtitle: "프로그램 개선/오류 수정 기록" },
];

export interface SidebarSelection {
  panel: "items" | "tree" | "notes" | "clipboard" | "settings" | "logs" | "git";
  /** Only meaningful when panel === "items" */
  group?: string;
  /** category key or "_all" — only meaningful when panel === "items" */
  categoryKey?: string;
  /** Only meaningful when panel === "logs" — one of LOG_CATEGORIES[].id */
  logCategory?: string;
}

export const DEFAULT_SELECTION: SidebarSelection = {
  panel: "items",
  group: "inbox",
  categoryKey: "_all",
};
