// ClipboardView — T2 clipboard history timeline.
//
// Streaming jsonl timeline (per-OS clipboard polls), newest-first or
// grouped by host. The shared-text sticky panel (T2.5, E-8-b) was
// removed — that "leave one message for the other side" role is covered
// by the dedicated Notes page (NotesView, E-12-a), which is a superset
// (multiple notes + titles + autosave). See
// mockups/clipboard-refactor/PROMPT.md.
//
// Sort toggle:
//   - "newest": every entry chronological, newest first (default)
//   - "by-host": grouped by host name, then newest-first within group

import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type ClipboardEntry, type ClipboardImageEntry } from "../lib/api";
import { useToast } from "../lib/toast";
import { fmtRelative } from "../lib/format";
import { useShareTopic } from "../lib/useShareTopic";

type SortMode = "newest" | "by-host";

function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s.trim());
}

export function ClipboardView() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const toast = useToast();

  const refresh = useCallback(
    () => api.listClipboardEntries(200).then(setEntries).catch(() => void 0),
    [],
  );
  useEffect(() => {
    refresh();
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

  // Memoize the grouped view so we don't reshuffle on every refresh tick.
  const groups = useMemo(() => groupEntries(entries, sortMode), [entries, sortMode]);

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
        <div className="clip-sort-row">
          <span className="clip-sort-label">정렬</span>
          <div className="clip-sort-tabs" role="tablist">
            <button
              role="tab"
              className={"clip-sort-tab" + (sortMode === "newest" ? " active" : "")}
              onClick={() => setSortMode("newest")}
            >
              ⏱ 최신순
            </button>
            <button
              role="tab"
              className={"clip-sort-tab" + (sortMode === "by-host" ? " active" : "")}
              onClick={() => setSortMode("by-host")}
            >
              👥 호스트별
            </button>
          </div>
          <span className="clip-sort-count">총 {entries.length}건</span>
        </div>

        {groups.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📋</div>
            <div className="empty-title">기록이 없어요</div>
            <div className="empty-hint">텍스트나 이미지를 복사하면 자동으로 여기 쌓여요.</div>
          </div>
        ) : sortMode === "by-host" ? (
          <div className="clip-timeline grouped">
            {groups.map((g) => (
              <div className="clip-group" key={g.key}>
                <header className="clip-group-head">
                  <span
                    className={
                      "clip-entry-os " +
                      (g.os === "macos" ? "clip-entry-os-mac" : "clip-entry-os-win")
                    }
                  >
                    {g.os === "macos" ? "Mac" : "Win"}
                  </span>
                  <span className="clip-group-host">{g.host}</span>
                  <span className="clip-group-count">{g.entries.length}건</span>
                </header>
                <div className="clip-group-body">
                  {g.entries.map((e, idx) =>
                    e.kind === "image" ? (
                      <ImageEntry
                        key={idx}
                        entry={e}
                        onClick={() => onClickEntry(e)}
                      />
                    ) : (
                      <TextEntry key={idx} entry={e} onClick={() => onClickEntry(e)} />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="clip-timeline">
            {entries.map((e, idx) =>
              e.kind === "image" ? (
                <ImageEntry key={idx} entry={e} onClick={() => onClickEntry(e)} />
              ) : (
                <TextEntry key={idx} entry={e} onClick={() => onClickEntry(e)} />
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}

interface Group {
  key: string;
  host: string;
  os: string;
  entries: ClipboardEntry[];
}

function groupEntries(entries: ClipboardEntry[], mode: SortMode): Group[] {
  if (mode !== "by-host") {
    return entries.length > 0
      ? [{ key: "_all", host: "_", os: "_", entries }]
      : [];
  }
  const m = new Map<string, Group>();
  for (const e of entries) {
    const key = `${e.os}:${e.host}`;
    let g = m.get(key);
    if (!g) {
      g = { key, host: e.host, os: e.os, entries: [] };
      m.set(key, g);
    }
    g.entries.push(e);
  }
  // Sort groups: macOS first, then alphabetical by host; entries within
  // each group are already newest-first because backend returns them that way.
  return [...m.values()].sort((a, b) => {
    if (a.os !== b.os) return a.os === "macos" ? -1 : 1;
    return a.host.localeCompare(b.host);
  });
}

// ─── Entry components (unchanged) ─────────────────────────────────

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
