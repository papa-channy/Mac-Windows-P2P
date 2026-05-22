import { useEffect, useState } from "react";
import { api, type ClipboardEntry } from "../lib/api";

function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s.trim());
}

function fmtRelative(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return iso.slice(0, 16);
}

export function ClipboardView() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);

  const refresh = () =>
    api.listClipboardEntries(200).then(setEntries).catch(() => void 0);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 2000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="panel">
      <header className="main-header">
        <div>
          <h2>📋 클립보드 (양쪽 통합)</h2>
          <div className="subtitle">양쪽 호스트가 OS 클립보드를 1.5초마다 자동 기록. 항목 클릭 → 내 OS 클립보드로 복사.</div>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={refresh}>↻ 다시 읽기</button>
          <button
            className="ghost-btn"
            onClick={async () => {
              if (!confirm("내 호스트의 클립보드 기록을 모두 지울까요?")) return;
              await api.clearOwnClipboardHistory();
              refresh();
            }}
          >
            🗑 내 기록 지우기
          </button>
        </div>
      </header>
      <div className="clip-timeline-body">
        <div className="clip-timeline">
          {entries.map((e, idx) => {
            const text = e.content.slice(0, 600);
            const url = isUrl(text);
            return (
              <div
                key={idx}
                className="clip-entry"
                onClick={() => api.copyToOsClipboard(e.content)}
              >
                <div className="clip-entry-head">
                  <span
                    className={
                      "clip-entry-os " +
                      (e.os === "macos" ? "clip-entry-os-mac" : "clip-entry-os-win")
                    }
                  >
                    {e.os === "macos" ? "Mac" : "Win"}
                  </span>
                  <span className="clip-entry-host">{e.host}</span>
                  <span className="clip-entry-time">{fmtRelative(e.ts)}</span>
                </div>
                <div className={"clip-entry-text" + (url ? " url" : "")}>{text}</div>
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📋</div>
              <div className="empty-title">기록이 없어요</div>
              <div className="empty-hint">텍스트를 복사하면 자동으로 여기 쌓여요.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
