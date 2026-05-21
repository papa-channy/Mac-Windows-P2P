import { useEffect, useState } from "react";
import { api, type Direction, type StateKey, type TransferItem } from "../lib/api";

const DIRECTIONS: { key: Direction; label: string }[] = [
  { key: "windows_to_mac", label: "Windows → Mac (받기)" },
  { key: "mac_to_windows", label: "Mac → Windows (보낸 것)" },
];

const STATES: { key: StateKey; label: string }[] = [
  { key: "ready", label: "Ready" },
  { key: "received", label: "Received" },
  { key: "staged", label: "Staged" },
  { key: "dropzone", label: "Dropzone" },
  { key: "rejected", label: "Rejected" },
];

export function TransfersView() {
  const [direction, setDirection] = useState<Direction>("windows_to_mac");
  const [state, setState] = useState<StateKey>("ready");
  const [items, setItems] = useState<TransferItem[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    api
      .listTransfers(direction, state)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [direction, state]);

  return (
    <section className="view view-transfers">
      <header className="view-header">
        <h1>전송</h1>
        <div className="view-controls">
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            {DIRECTIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value as StateKey)}>
            {STATES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      {error && <div className="error-box">{error}</div>}
      <ul className="transfer-list">
        {items.map((it) => (
          <li key={it.path} className="transfer-row">
            <span className="t-emoji">{it.category_emoji}</span>
            <span className="t-name">{it.name}</span>
            <span className="t-meta">
              {(it.size_bytes / 1024).toFixed(1)} KB · {it.modified_iso.slice(0, 19)}
            </span>
            <button onClick={() => api.revealInExplorer(it.path)}>Finder</button>
          </li>
        ))}
        {!items.length && !error && <li className="empty">표시할 항목이 없습니다.</li>}
      </ul>
    </section>
  );
}
