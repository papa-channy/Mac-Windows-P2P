// nav.ts — sidebar navigation data shared by Sidebar.tsx and panels.
//
// Mirror of windows_gui/share-manager/src/app.js NAV_GROUPS (app.js:27–31).
// One source of truth so re-arranging on either side keeps both consistent.

import type { Direction, StateKey } from "./api";

export interface NavGroup {
  id: string;
  label: string;       // sidebar header (UPPERCASE rendered by CSS)
  emoji: string;       // optional inline glyph for the header
  direction: Direction;
  state: StateKey;
}

/**
 * Three groups on the Mac side:
 *   - INBOX     receive from Windows  (direction = windows_to_mac, state = ready)
 *   - OUTBOX    files we sent         (direction = mac_to_windows, state = ready)
 *   - RECEIVED  archived after open   (direction = windows_to_mac, state = received)
 *
 * The Windows side has the analogous mirror (mac_to_windows ready as inbox,
 * windows_to_mac ready as outbox, mac_to_windows received as archive).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "inbox",
    label: "Windows에서 받기",
    emoji: "📥",
    direction: "windows_to_mac",
    state: "ready",
  },
  {
    id: "outbox",
    label: "Windows로 보낸 것",
    emoji: "📤",
    direction: "mac_to_windows",
    state: "ready",
  },
  {
    id: "received",
    label: "받은 기록 (archive)",
    emoji: "🗂",
    direction: "windows_to_mac",
    state: "received",
  },
];

export interface SidebarSelection {
  panel: "items" | "tree" | "notes" | "clipboard" | "settings";
  /** Only meaningful when panel === "items" */
  group?: string;
  /** category key or "_all" — only meaningful when panel === "items" */
  categoryKey?: string;
}

export const DEFAULT_SELECTION: SidebarSelection = {
  panel: "items",
  group: "inbox",
  categoryKey: "_all",
};
