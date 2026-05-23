// SharedClipboardPanel — T2.5 "공유 텍스트" widget at the top of
// ClipboardView. Single sticky-note style payload (current.json under
// 00_System/70_Clipboard) that either host can overwrite. Distinct from
// the streaming jsonl timeline below — this is the "leave one message
// for the other side" channel.
//
// Auto-refreshes on share-changed (topic="clipboard") events so the
// other side's writes appear without a manual refresh.

import { useCallback, useEffect, useState } from "react";
import { api, type SharedClipboardEntry } from "../lib/api";
import { useShareTopic } from "../lib/useShareTopic";
import { useToast } from "../lib/toast";
import { fmtRelative } from "../lib/format";

export function SharedClipboardPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState<SharedClipboardEntry | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SharedClipboardEntry[]>([]);

  const refresh = useCallback(async () => {
    try {
      const cur = await api.readSharedClipboard();
      setCurrent(cur);
      if (!editing) setDraft(cur.content);
    } catch {
      /* ignore — file probably absent on first run */
    }
  }, [editing]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useShareTopic("clipboard", refresh);

  const save = async () => {
    setBusy(true);
    try {
      const result = await api.writeSharedClipboard(draft);
      setCurrent(result);
      setEditing(false);
      toast("공유 텍스트가 저장됐어요", "success");
      if (showHistory) {
        const h = await api.listClipboardHistory(50);
        setHistory(h);
      }
    } catch (e) {
      toast(`저장 실패: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDraft(current?.content ?? "");
    setEditing(false);
  };

  const copyToOs = async () => {
    if (!current || current.empty) return;
    try {
      await api.copyToOsClipboard(current.content);
      toast("공유 텍스트를 내 OS 클립보드에 복사했어요", "success");
    } catch (e) {
      toast(`복사 실패: ${e}`, "error");
    }
  };

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history.length === 0) {
      try {
        const h = await api.listClipboardHistory(50);
        setHistory(h);
      } catch (e) {
        toast(`히스토리 로드 실패: ${e}`, "error");
      }
    }
  };

  const restore = (entry: SharedClipboardEntry) => {
    setDraft(entry.content);
    setEditing(true);
  };

  const empty = !current || current.empty;

  return (
    <section className="shared-clip">
      <header className="shared-clip-head">
        <h3>
          <span aria-hidden>📌</span>
          <span>공유 텍스트 (Shared clipboard)</span>
        </h3>
        <span className="shared-clip-sub">
          양쪽 호스트가 한 메시지를 공유 — 마지막으로 저장한 사람이 덮어써요.
        </span>
      </header>

      {editing ? (
        <div className="shared-clip-edit">
          <textarea
            className="shared-clip-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="다른 호스트로 보낼 메시지를 적어요…"
            rows={5}
            spellCheck={false}
            disabled={busy}
          />
          <div className="shared-clip-actions">
            <button className="ghost-btn" onClick={cancel} disabled={busy}>
              취소
            </button>
            <button className="primary-btn" onClick={save} disabled={busy}>
              {busy ? "저장 중…" : "저장 + 게시"}
            </button>
          </div>
        </div>
      ) : (
        <div className={"shared-clip-view" + (empty ? " empty" : "")}>
          {empty ? (
            <p className="shared-clip-empty">
              아직 공유된 텍스트가 없어요. 입력하면 다른 쪽 호스트가 1.5초 안에 받아봐요.
            </p>
          ) : (
            <>
              <pre className="shared-clip-body">{current!.content}</pre>
              <div className="shared-clip-meta">
                {current?.from && (
                  <span className="shared-clip-from">
                    <span
                      className={
                        "clip-entry-os " +
                        (current.from.os === "macos"
                          ? "clip-entry-os-mac"
                          : "clip-entry-os-win")
                      }
                    >
                      {current.from.os === "macos" ? "Mac" : "Win"}
                    </span>
                    <span className="shared-clip-host">{current.from.host}</span>
                  </span>
                )}
                {current?.created_at && (
                  <span className="shared-clip-time">
                    {fmtRelative(current.created_at)}
                  </span>
                )}
              </div>
            </>
          )}
          <div className="shared-clip-actions">
            <button className="ghost-btn" onClick={toggleHistory}>
              {showHistory ? "히스토리 닫기" : `히스토리 보기 (최대 50)`}
            </button>
            {!empty && (
              <button className="ghost-btn" onClick={copyToOs}>
                내 OS 클립보드로 복사
              </button>
            )}
            <button
              className="primary-btn"
              onClick={() => {
                setDraft(current?.content ?? "");
                setEditing(true);
              }}
            >
              {empty ? "메시지 작성" : "수정 / 덮어쓰기"}
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="shared-clip-history">
          {history.length === 0 ? (
            <p className="shared-clip-empty">아직 보관된 메시지가 없어요.</p>
          ) : (
            history.map((h, i) => (
              <button
                key={i}
                className="shared-clip-history-row"
                onClick={() => restore(h)}
                title="클릭하면 입력창에 이 버전을 불러와요"
              >
                <span className="shared-clip-history-meta">
                  {h.from && (
                    <span
                      className={
                        "clip-entry-os " +
                        (h.from.os === "macos"
                          ? "clip-entry-os-mac"
                          : "clip-entry-os-win")
                      }
                    >
                      {h.from.os === "macos" ? "Mac" : "Win"}
                    </span>
                  )}
                  {h.from && <span className="shared-clip-host">{h.from.host}</span>}
                  {h.created_at && (
                    <span className="shared-clip-time">{fmtRelative(h.created_at)}</span>
                  )}
                </span>
                <span className="shared-clip-history-preview">
                  {h.content.slice(0, 140) + (h.content.length > 140 ? "…" : "")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
