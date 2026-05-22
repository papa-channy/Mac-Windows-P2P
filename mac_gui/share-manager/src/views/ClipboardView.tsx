import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type ClipboardEntry, type ClipboardImageEntry } from "../lib/api";
import { useToast } from "../lib/toast";
import { fmtRelative } from "../lib/format";
import { useShareTopic } from "../lib/useShareTopic";

function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s.trim());
}

export function ClipboardView() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const toast = useToast();

  const refresh = useCallback(
    () => api.listClipboardEntries(200).then(setEntries).catch(() => void 0),
    [],
  );
  useEffect(() => {
    refresh();
    // Belt-and-suspenders 2s poll. With the share-changed watcher wired up
    // (below) the typical refresh happens via the event; the interval
    // catches the case where the watcher dropped events (SMB hiccup) or
    // the user's own NSPasteboard poll just appended to its own jsonl.
    const t = window.setInterval(refresh, 2000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useShareTopic("clipboard", refresh);

  const onClickEntry = async (e: ClipboardEntry) => {
    try {
      if (e.kind === "image") {
        await api.copyImageToOsClipboard(e.image_ref);
        toast("이미지를 클립보드에 복사했어요", "success");
      } else {
        await api.copyToOsClipboard(e.content);
        toast("텍스트를 클립보드에 복사했어요", "success");
      }
    } catch (err) {
      toast("복사 실패: " + String(err), "error");
    }
  };

  return (
    <section className="panel">
      <header className="main-header">
        <div>
          <h2>📋 클립보드 (양쪽 통합)</h2>
          <div className="subtitle">
            양쪽 호스트가 OS 클립보드를 1.5초마다 자동 기록 · 이미지 30일 보관 후 자동 정리 · 항목 클릭 → 내 OS 클립보드로 복사
          </div>
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
          {entries.map((e, idx) =>
            e.kind === "image" ? (
              <ImageEntry key={idx} entry={e} onClick={() => onClickEntry(e)} />
            ) : (
              <TextEntry key={idx} entry={e} onClick={() => onClickEntry(e)} />
            ),
          )}
          {entries.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📋</div>
              <div className="empty-title">기록이 없어요</div>
              <div className="empty-hint">텍스트나 이미지를 복사하면 자동으로 여기 쌓여요.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Entry components ─────────────────────────────────────────────

function EntryHead({ entry }: { entry: ClipboardEntry }) {
  return (
    <div className="clip-entry-head">
      <span
        className={
          "clip-entry-os " +
          (entry.os === "macos" ? "clip-entry-os-mac" : "clip-entry-os-win")
        }
      >
        {entry.os === "macos" ? "Mac" : "Win"}
      </span>
      <span className="clip-entry-host">{entry.host}</span>
      <span className="clip-entry-time">{fmtRelative(entry.ts)}</span>
    </div>
  );
}

function TextEntry({
  entry,
  onClick,
}: {
  entry: ClipboardEntry;
  onClick: () => void;
}) {
  const text = entry.content.slice(0, 600);
  const url = isUrl(text);
  return (
    <div className="clip-entry" onClick={onClick}>
      <EntryHead entry={entry} />
      <div className={"clip-entry-text" + (url ? " url" : "")}>{text}</div>
    </div>
  );
}

function ImageEntry({
  entry,
  onClick,
}: {
  entry: ClipboardImageEntry;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    api
      .clipboardImagePath(entry.image_ref)
      .then((p) => { if (!cancelled) setSrc(convertFileSrc(p)); })
      .catch(() => { if (!cancelled) setSrc(""); });
    return () => { cancelled = true; };
  }, [entry.image_ref]);

  const kb = Math.round(entry.size_bytes / 1024);
  return (
    <div className="clip-entry clip-entry-image" onClick={onClick}>
      <EntryHead entry={entry} />
      <div className="clip-image-wrap">
        {src ? (
          <img className="clip-image-thumb" src={src} alt="clipboard image" />
        ) : (
          <div className="clip-image-missing">이미지 로드 실패 / 만료됨</div>
        )}
        <span className="clip-image-meta">
          {entry.width} × {entry.height} · {kb} KB
        </span>
      </div>
    </div>
  );
}
