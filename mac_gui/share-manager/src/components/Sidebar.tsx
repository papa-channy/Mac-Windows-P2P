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

export function Sidebar({
  selection,
  settingsActive,
  counts,
  status,
  onSelect,
  onToggleSettings,
  onRefresh,
}: Props) {
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

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">⇄</div>
        <div className="brand-text">
          <div className="brand-title">Mac-Window</div>
          <div className="brand-subtitle">공유 관리자</div>
        </div>
      </div>

      <div className="nav-pinned">
        <button
          className={
            "nav-item" +
            (isActive({ panel: "tree" }) ? " active" : "")
          }
          onClick={() => onSelect({ panel: "tree" })}
        >
          <span className="nav-item-emoji">🚀</span>
          <span className="nav-item-label">빠른 전송</span>
        </button>
      </div>

      <nav className="nav">
        {NAV_GROUPS.map((group) => {
          const groupCounts = counts[group.id] ?? {};
          const totalCount = groupCounts._all ?? 0;
          return (
            <div className="nav-group" key={group.id}>
              <div className="nav-group-header">
                <span>{group.emoji}</span>
                <span>{group.title}</span>
              </div>
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
                <span className="nav-item-emoji">📋</span>
                <span className="nav-item-label">전체</span>
                <span className="nav-item-count">{totalCount}</span>
              </button>
              {CATEGORIES.map((cat) => {
                const count = groupCounts[cat.key] ?? 0;
                if (count === 0) return null;
                return (
                  <button
                    key={cat.key}
                    className={
                      "nav-item" +
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
                    <span className="nav-item-emoji">
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
      </nav>

      <div className="nav-group">
        <div className="nav-group-header">
          <span>📑</span>
          <span>Log Hub</span>
        </div>
        {LOG_CATEGORIES.map((lc) => (
          <button
            key={lc.id}
            className={
              "nav-item" +
              (isActive({ panel: "logs", logCategory: lc.id }) ? " active" : "")
            }
            onClick={() => onSelect({ panel: "logs", logCategory: lc.id })}
            title={lc.subtitle}
          >
            <span className="nav-item-emoji">{lc.emoji}</span>
            <span className="nav-item-label">{lc.label}</span>
          </button>
        ))}
      </div>

      <div className="nav-tools">
        <button
          className={
            "nav-item" + (isActive({ panel: "notes" }) ? " active" : "")
          }
          onClick={() => onSelect({ panel: "notes" })}
        >
          <span className="nav-item-emoji">📝</span>
          <span className="nav-item-label">공유 메모</span>
        </button>
        <button
          className={
            "nav-item" + (isActive({ panel: "clipboard" }) ? " active" : "")
          }
          onClick={() => onSelect({ panel: "clipboard" })}
        >
          <span className="nav-item-emoji">📋</span>
          <span className="nav-item-label">클립보드</span>
        </button>
      </div>

      <button className="refresh" onClick={onRefresh} title="새로고침">
        <span className="refresh-icon">↻</span>
        <span>새로고침</span>
      </button>

      <button
        className={"settings-btn" + (settingsActive ? " active" : "")}
        onClick={onToggleSettings}
        title="설정"
      >
        <span className="settings-icon">⚙</span>
        <span>설정</span>
      </button>

      <div className="status">{status}</div>
    </aside>
  );
}
