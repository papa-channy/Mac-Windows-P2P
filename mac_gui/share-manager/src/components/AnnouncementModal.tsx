import type { ReleaseEntry } from "../lib/api";

interface Props {
  entry: ReleaseEntry;
  isWelcome: boolean;
  onClose: () => void;
}

export function AnnouncementModal({ entry, isWelcome, onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel announcement"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <div className="modal-eyebrow">
              {isWelcome ? "환영합니다" : `v${entry.version} 업데이트`}
            </div>
            <h2 className="modal-title">{entry.title}</h2>
          </div>
          <button className="modal-close" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">
          {entry.highlights.length > 0 && (
            <ul className="highlights">
              {entry.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
          {entry.notes && <p className="notes-prose">{entry.notes}</p>}
        </div>
        <footer className="modal-footer">
          <span className="modal-meta">{entry.date}</span>
          <button className="primary" onClick={onClose}>
            {isWelcome ? "시작하기" : "확인"}
          </button>
        </footer>
      </div>
    </div>
  );
}
