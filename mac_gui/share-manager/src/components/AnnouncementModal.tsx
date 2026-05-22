import type { ReleaseEntry } from "../lib/api";

interface Props {
  entry: ReleaseEntry;
  isWelcome: boolean;
  onClose: () => void;
}

export function AnnouncementModal({ entry, isWelcome, onClose }: Props) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-backdrop" />
      <div
        className="modal-window"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{isWelcome ? "환영합니다 — " : `v${entry.version} · `}{entry.title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {entry.highlights.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {entry.highlights.map((h, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{h}</li>
              ))}
            </ul>
          )}
          {entry.notes && (
            <div className="detail-mono" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
              {entry.notes}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="settings-hint" style={{ marginRight: "auto" }}>{entry.date}</span>
          <button className="primary-btn" onClick={onClose}>
            {isWelcome ? "시작하기" : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
