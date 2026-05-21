import type { ViewKey } from "../App";

interface Props {
  current: ViewKey;
  onSelect: (v: ViewKey) => void;
  shareRoot: string;
}

const ITEMS: { key: ViewKey; label: string; emoji: string }[] = [
  { key: "transfers", label: "전송", emoji: "📦" },
  { key: "notes", label: "메모", emoji: "📝" },
  { key: "clipboard", label: "클립보드", emoji: "📋" },
  { key: "settings", label: "설정", emoji: "⚙" },
];

export function Sidebar({ current, onSelect, shareRoot }: Props) {
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="sidebar-title">Mac-Window 공유</div>
        <div className="sidebar-root" title={shareRoot}>
          {shareRoot || "…"}
        </div>
      </header>
      <nav className="sidebar-nav">
        {ITEMS.map((it) => (
          <button
            key={it.key}
            className={"sidebar-item" + (current === it.key ? " is-active" : "")}
            onClick={() => onSelect(it.key)}
          >
            <span className="sidebar-emoji">{it.emoji}</span>
            <span className="sidebar-label">{it.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
