// Sidebar — 3-zone layout:
//   1. Brand (fixed top)
//   2. Pinned actions (fixed, never scrolls): Fast Forward / Notes /
//      Clipboard / Git Status / Refresh / Settings
//   3. Scrollable nav body:
//      - Transfer groups (In / Out) — `All` always visible, categories
//        collapsible (default closed).
//      - Log Hub (collapsible, default closed) — Sent / Received /
//        Errors / Compressed images / Worklog + Archive.
//   4. Status bar (fixed bottom)
//
// Windows-parity: NAV_GROUPS = inbox + outbox (matches Win app.js:28).
// Mac-only `received` state lives as the "Archive" sub-item under Log
// Hub instead of as its own top-level group.

import { useState } from "react";
import {
  Zap,
  StickyNote,
  Clipboard as ClipboardIcon,
  GitBranch,
  RefreshCw,
  Settings as SettingsIcon,
  Inbox,
  Send,
  Archive as ArchiveIcon,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  ScrollText,
  Upload,
  Download,
  AlertTriangle,
  Image as ImageIcon,
  History,
} from "lucide-react";
import { NAV_GROUPS, LOG_CATEGORIES } from "../lib/nav";
import { CATEGORIES } from "../lib/categories";
import type { SidebarSelection } from "../lib/nav";
import { CategoryIcon } from "./IconImg";

interface Props {
  selection: SidebarSelection;
  settingsActive: boolean;
  /** count per (groupId, categoryKey) — `_all` key holds the group total */
  counts: Record<string, Record<string, number>>;
  status: string;
  onSelect: (s: SidebarSelection) => void;
  onToggleSettings: () => void;
  onRefresh: () => void;
}

const GROUP_ICON: Record<string, typeof Inbox> = {
  inbox: Inbox,
  outbox: Send,
  received: ArchiveIcon,
};

const LOG_ICON: Record<string, typeof Upload> = {
  send: Upload,
  recv: Download,
  error: AlertTriangle,
  compressed: ImageIcon,
  worklog: History,
};

export function Sidebar({
  selection,
  settingsActive,
  counts,
  status,
  onSelect,
  onToggleSettings,
  onRefresh,
}: Props) {
  const [logOpen, setLogOpen] = useState(false);
  // Per-group category dropdown state. Default closed — All is always
  // visible, sub-categories show only when the user expands.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const isActive = (s: SidebarSelection) => {
    if (settingsActive) return false;
    if (selection.panel !== s.panel) return false;
    if (s.panel === "items") {
      return selection.group === s.group && selection.categoryKey === s.categoryKey;
    }
    if (s.panel === "logs") {
      return selection.logCategory === s.logCategory;
    }
    return true;
  };

  // Windows-parity: only show inbox + outbox as top-level transfer
  // groups. The mac-only `received` state surfaces as the "Archive"
  // sub-item under Log Hub.
  const transferGroups = NAV_GROUPS.filter(
    (g) => g.id === "inbox" || g.id === "outbox",
  );
  const archiveCount = counts.received?._all ?? 0;
  const isArchiveActive =
    !settingsActive &&
    selection.panel === "items" &&
    selection.group === "received";

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">⇄</div>
        <div className="brand-text">
          <div className="brand-title">Mac-Window</div>
          <div className="brand-subtitle">Shared workspace</div>
        </div>
      </div>

      {/* Pinned — always visible, never scrolls */}
      <div className="nav-pinned">
        <PinButton
          icon={<Zap size={16} />}
          label="Fast Forward"
          active={isActive({ panel: "tree" })}
          onClick={() => onSelect({ panel: "tree" })}
        />
        <PinButton
          icon={<StickyNote size={16} />}
          label="Notes"
          active={isActive({ panel: "notes" })}
          onClick={() => onSelect({ panel: "notes" })}
        />
        <PinButton
          icon={<ClipboardIcon size={16} />}
          label="Clipboard"
          active={isActive({ panel: "clipboard" })}
          onClick={() => onSelect({ panel: "clipboard" })}
        />
        <PinButton
          icon={<GitBranch size={16} />}
          label="Git Status"
          active={isActive({ panel: "git" })}
          onClick={() => onSelect({ panel: "git" })}
        />
        <PinButton
          icon={<RefreshCw size={16} />}
          label="Refresh"
          active={false}
          onClick={onRefresh}
        />
        <PinButton
          icon={<SettingsIcon size={16} />}
          label="Settings"
          active={settingsActive}
          onClick={onToggleSettings}
        />
      </div>

      {/* Scrollable nav — Transfer groups + Log Hub */}
      <nav className="nav-scroll">
        {transferGroups.map((group) => {
          const groupCounts = counts[group.id] ?? {};
          const totalCount = groupCounts._all ?? 0;
          const GroupIcon = GROUP_ICON[group.id] ?? Inbox;
          const isOpen = openGroups[group.id] ?? false;
          return (
            <div className="nav-group" key={group.id}>
              <button
                type="button"
                className="nav-group-header nav-group-toggle"
                onClick={() =>
                  setOpenGroups((p) => ({ ...p, [group.id]: !isOpen }))
                }
                aria-expanded={isOpen}
                title={isOpen ? "Collapse categories" : "Expand categories"}
              >
                <GroupIcon size={14} className="nav-group-icon" />
                <span>{group.title}</span>
                <span className="nav-group-chevron">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>
              <button
                className={
                  "nav-item" +
                  (isActive({ panel: "items", group: group.id, categoryKey: "_all" })
                    ? " active"
                    : "")
                }
                onClick={() =>
                  onSelect({ panel: "items", group: group.id, categoryKey: "_all" })
                }
              >
                <span className="nav-item-icon">
                  <LayoutGrid size={15} />
                </span>
                <span className="nav-item-label">All</span>
                <span className="nav-item-count">{totalCount}</span>
              </button>
              {isOpen &&
                CATEGORIES.map((cat) => {
                  const count = groupCounts[cat.key] ?? 0;
                  const empty = count === 0;
                  return (
                    <button
                      key={cat.key}
                      className={
                        "nav-item" +
                        (empty ? " is-empty" : "") +
                        (isActive({
                          panel: "items",
                          group: group.id,
                          categoryKey: cat.key,
                        })
                          ? " active"
                          : "")
                      }
                      onClick={() =>
                        onSelect({
                          panel: "items",
                          group: group.id,
                          categoryKey: cat.key,
                        })
                      }
                    >
                      <span className="nav-item-icon">
                        <CategoryIcon categoryKey={cat.key} emoji={cat.emoji} />
                      </span>
                      <span className="nav-item-label">{cat.label}</span>
                      <span className="nav-item-count">{count}</span>
                    </button>
                  );
                })}
            </div>
          );
        })}

        {/* Log Hub — collapsible, default closed. Includes Archive
         * (mac-only `received` state) as the 6th sub-item. */}
        <div className="nav-group">
          <button
            type="button"
            className="nav-group-header nav-group-toggle"
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
          >
            <ScrollText size={14} className="nav-group-icon" />
            <span>Log Hub</span>
            <span className="nav-group-chevron">
              {logOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
          {logOpen && (
            <>
              {LOG_CATEGORIES.map((lc) => {
                const Icon = LOG_ICON[lc.id] ?? History;
                return (
                  <button
                    key={lc.id}
                    className={
                      "nav-item" +
                      (isActive({ panel: "logs", logCategory: lc.id }) ? " active" : "")
                    }
                    onClick={() => onSelect({ panel: "logs", logCategory: lc.id })}
                    title={lc.subtitle}
                  >
                    <span className="nav-item-icon">
                      <Icon size={15} />
                    </span>
                    <span className="nav-item-label">{lc.label}</span>
                  </button>
                );
              })}
              <button
                className={"nav-item" + (isArchiveActive ? " active" : "")}
                onClick={() =>
                  onSelect({
                    panel: "items",
                    group: "received",
                    categoryKey: "_all",
                  })
                }
                title="Windows → Mac 수신 후 archive 한 파일 목록"
              >
                <span className="nav-item-icon">
                  <ArchiveIcon size={15} />
                </span>
                <span className="nav-item-label">Archive</span>
                <span className="nav-item-count">{archiveCount}</span>
              </button>
            </>
          )}
        </div>
      </nav>

      <div className="status">{status}</div>
    </aside>
  );
}

function PinButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"nav-pin" + (active ? " active" : "")}
      onClick={onClick}
      title={label}
    >
      <span className="nav-pin-icon">{icon}</span>
      <span className="nav-pin-label">{label}</span>
    </button>
  );
}
