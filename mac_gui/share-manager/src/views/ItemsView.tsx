// ItemsView.tsx — Inbox / Outbox / Received list. Selection comes from
// the Sidebar (group + categoryKey). Mirrors renderItems() in
// windows_gui/share-manager/src/app.js (app.js:1151–1210).

import { useMemo, useState } from "react";
import { api, type TransferItem } from "../lib/api";
import type { SidebarSelection } from "../lib/nav";
import { NAV_GROUPS } from "../lib/nav";
import { CATEGORIES } from "../lib/categories";
import { useToast } from "../lib/toast";
import {
  fmtBytes,
  fmtFull,
  fmtRelative,
  parseTransferName,
  prettyName,
} from "../lib/format";
import { DetailsModal } from "../components/DetailsModal";
import { IconImg } from "../components/IconImg";

interface Props {
  selection: SidebarSelection;
  items: TransferItem[];
  onRefresh: () => void;
}

export function ItemsView({ selection, items, onRefresh }: Props) {
  const [detailsItem, setDetailsItem] = useState<TransferItem | null>(null);
  const toast = useToast();

  const group = NAV_GROUPS.find((g) => g.id === selection.group);
  const cat =
    selection.categoryKey && selection.categoryKey !== "_all"
      ? CATEGORIES.find((c) => c.key === selection.categoryKey)
      : null;

  const filtered = useMemo(() => {
    if (!cat) return items;
    return items.filter((it) => it.category_key === cat.key);
  }, [items, cat]);

  const title = cat ? `${cat.emoji}  ${cat.label}` : group?.title ?? "항목";
  const directionLabel =
    group?.direction === "mac_to_windows" ? "Windows로 보냄" : "Windows에서 받음";

  const revealCurrent = async () => {
    if (!group) return;
    try {
      const root = await api.shareRoot();
      const dirName =
        group.direction === "mac_to_windows"
          ? "10_Mac_to_Windows"
          : "20_Windows_to_Mac";
      const stateName = group.state === "received" ? "90_Received" : "20_Ready";
      const target = cat
        ? `${root}/10_Exchange/${dirName}/${stateName}/${cat.folder}`
        : `${root}/10_Exchange/${dirName}/${stateName}`;
      await api.openPath(target);
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <section className="panel">
      <header className="main-header">
        <div>
          <h2>{title}</h2>
          <div className="subtitle">
            {filtered.length}개 항목 · {directionLabel}
          </div>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={onRefresh} title="새로고침">
            ↻ 새로고침
          </button>
          <button
            className="ghost-btn"
            onClick={revealCurrent}
            title="Finder에서 열기"
          >
            📂 폴더 열기
          </button>
        </div>
      </header>

      <div className="items-container">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📭</div>
            <div className="empty-title">아직 항목이 없어요</div>
            <div className="empty-hint">
              왼쪽 사이드바의 "빠른 전송"에서 파일을 골라 보내거나, 창에
              끌어다 놓으세요.
            </div>
          </div>
        ) : (
          <ul className="items">
            {filtered.map((it) => (
              <ItemRow
                key={it.path}
                item={it}
                onClick={() => setDetailsItem(it)}
                onDoubleClick={() =>
                  api
                    .openPath(it.path)
                    .catch((e) => toast(String(e), "error"))
                }
              />
            ))}
          </ul>
        )}
      </div>

      <div className="hint-bar">
        <span className="hint-icon">↓</span>
        <span>파일/폴더를 창에 드래그하면 Windows로 보내요</span>
      </div>

      <DetailsModal item={detailsItem} onClose={() => setDetailsItem(null)} />
    </section>
  );
}

// ─── Single item row ─────────────────────────────────────────────

interface RowProps {
  item: TransferItem;
  onClick: () => void;
  onDoubleClick: () => void;
}

function ItemRow({ item, onClick, onDoubleClick }: RowProps) {
  const parsed = parseTransferName(item.name);
  const displayName = prettyName(item.name);
  // For themed icon resolution, use the parsed basename+ext so the VSCode
  // resolver can match the real extension (not the noisy v01-suffixed one).
  const iconName = parsed ? parsed.basename + parsed.ext : item.name;
  const metaParts: string[] = [
    `${item.category_emoji} ${item.category_label}`,
    fmtBytes(item.size_bytes),
  ];
  if (parsed) {
    metaParts.push(`v${parsed.version}`);
    metaParts.push(parsed.date);
  }
  metaParts.push(fmtRelative(item.modified_iso));

  return (
    <li className="item" onClick={onClick} onDoubleClick={onDoubleClick}>
      <div className="item-icon"><IconImg name={iconName} isDir={item.is_dir} /></div>
      <div className="item-body">
        <div className="item-name" title={item.name}>
          {displayName}
        </div>
        <div className="item-meta">{metaParts.join(" · ")}</div>
      </div>
      <div className="item-tail">{fmtFull(item.modified_iso)}</div>
    </li>
  );
}
