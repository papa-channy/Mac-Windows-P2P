import { useEffect, useState } from "react";
import { api, type ClipboardEntry } from "../lib/api";

export function ClipboardView() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);

  const refresh = () =>
    api.listClipboardEntries(200).then(setEntries).catch(() => void 0);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 3000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="view view-clipboard">
      <header className="view-header">
        <h1>클립보드</h1>
        <button onClick={() => api.clearOwnClipboardHistory().then(refresh)}>
          내 기록 비우기
        </button>
      </header>
      <ul className="clip-list">
        {entries.map((e, idx) => (
          <li key={idx} className="clip-row" onClick={() => api.copyToOsClipboard(e.content)}>
            <span className={"clip-os clip-os-" + e.os}>{e.os === "macos" ? "Mac" : "Win"}</span>
            <span className="clip-ts">{e.ts.slice(0, 19)}</span>
            <span className="clip-content">{e.content.slice(0, 160)}</span>
          </li>
        ))}
        {!entries.length && <li className="empty">기록이 없습니다.</li>}
      </ul>
    </section>
  );
}
