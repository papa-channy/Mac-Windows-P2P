// Notes view — minimal Phase A version using new design tokens.
// Phase F polishes autosave, host badge, watcher integration.
import { useEffect, useRef, useState } from "react";
import { api, type NoteEntry } from "../lib/api";

export function NotesView() {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [selected, setSelected] = useState<NoteEntry | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const saveTimer = useRef<number | null>(null);

  const refresh = () => api.listNotes().then(setNotes).catch(() => void 0);
  useEffect(() => {
    refresh();
  }, []);

  const openNote = async (id: string) => {
    const n = await api.getNote(id);
    setSelected(n);
    setTitle(n.title);
    setBody(n.body);
    setSaveStatus("");
  };

  const scheduleSave = (nextTitle: string, nextBody: string) => {
    setSaveStatus("편집 중…");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const saved = await api.saveNote(selected?.id ?? null, nextTitle, nextBody);
        setSelected(saved);
        setSaveStatus("저장됨");
        refresh();
      } catch (e) {
        setSaveStatus("저장 실패: " + e);
      }
    }, 600);
  };

  return (
    <section className="panel">
      <header className="main-header">
        <div>
          <h2>📝 공유 메모</h2>
          <div className="subtitle">셰어를 통해 양쪽이 같은 메모 편집. 입력 시 자동 저장 (0.6초 디바운스).</div>
        </div>
        <div className="header-actions">
          <button
            className="primary-btn"
            onClick={() => {
              setSelected(null);
              setTitle("");
              setBody("");
              setSaveStatus("");
            }}
          >
            ＋ 새 메모
          </button>
        </div>
      </header>
      <div className="notes-body">
        <aside className="notes-list-pane">
          <div className="notes-list">
            {notes.map((n) => (
              <div
                key={n.id}
                className={"note-list-item" + (selected?.id === n.id ? " active" : "")}
                onClick={() => openNote(n.id)}
              >
                <div className="note-list-item-title">{n.title || "(제목 없음)"}</div>
                <div className="note-list-item-snippet">
                  {((n as unknown as { snippet?: string }).snippet) ?? n.body?.slice(0, 160) ?? ""}
                </div>
                <div className="note-list-item-meta">
                  {n.updated_at?.slice(0, 16)} · {n.updated_by?.host}
                </div>
              </div>
            ))}
            {notes.length === 0 && (
              <div className="empty" style={{ padding: "16px 8px" }}>
                <div className="empty-hint">메모가 없어요.</div>
              </div>
            )}
          </div>
        </aside>
        <div className="notes-editor-pane">
          <div className="notes-editor">
            <input
              className="note-title-input"
              placeholder="제목"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave(e.target.value, body);
              }}
            />
            <div className="note-meta">
              {selected
                ? `${selected.updated_at?.slice(0, 19)} · ${selected.updated_by?.host} (${selected.updated_by?.os})`
                : "새 메모"}
            </div>
            <textarea
              className="note-body-input"
              placeholder="여기에 작성…"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleSave(title, e.target.value);
              }}
            />
            <div className="note-actions">
              {selected && (
                <button
                  className="ghost-btn"
                  onClick={async () => {
                    if (!confirm("이 메모를 삭제할까요?")) return;
                    await api.deleteNote(selected.id);
                    setSelected(null);
                    setTitle("");
                    setBody("");
                    refresh();
                  }}
                >
                  🗑 삭제
                </button>
              )}
              <span className="settings-hint">{saveStatus}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
