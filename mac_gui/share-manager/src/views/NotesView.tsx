import { useEffect, useRef, useState } from "react";
import { api, type NoteEntry } from "../lib/api";

export function NotesView() {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [selected, setSelected] = useState<NoteEntry | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
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
  };

  const scheduleSave = (nextTitle: string, nextBody: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const saved = await api.saveNote(selected?.id ?? null, nextTitle, nextBody);
      setSelected(saved);
      refresh();
    }, 600);
  };

  return (
    <section className="view view-notes">
      <aside className="notes-list">
        <button
          className="new-note"
          onClick={() => {
            setSelected(null);
            setTitle("");
            setBody("");
          }}
        >
          + 새 메모
        </button>
        {notes.map((n) => (
          <button
            key={n.id}
            className={"note-row" + (selected?.id === n.id ? " is-active" : "")}
            onClick={() => openNote(n.id)}
          >
            <div className="note-title">{n.title || "(제목 없음)"}</div>
            <div className="note-snippet">{n.body.slice(0, 80)}</div>
          </button>
        ))}
      </aside>
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
        <textarea
          className="note-body-input"
          placeholder="내용 (마크다운 또는 일반 텍스트)"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            scheduleSave(title, e.target.value);
          }}
        />
        {selected && (
          <button
            className="delete-note"
            onClick={async () => {
              await api.deleteNote(selected.id);
              setSelected(null);
              setTitle("");
              setBody("");
              refresh();
            }}
          >
            삭제
          </button>
        )}
      </div>
    </section>
  );
}
