// LogsView — T4 panel rendered when the sidebar Log Hub items are
// selected. Reads JSONL streams from <share>/00_System/80_Logs via
// `list_log_entries`. The 5th sidebar item ("compressed") branches to
// the compressed-images gallery instead.
//
// Mirror of windows_gui/share-manager/src/app.js::renderLogView +
// renderLogEntries + renderCompressedImages (post-7358b1a labels).

import { useEffect, useMemo, useState } from "react";
import { api, type LogEntry, type LogCategoryId } from "../lib/api";
import { LOG_CATEGORIES } from "../lib/nav";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  /** One of LOG_CATEGORIES[].id — falls back to the first item if missing. */
  logCategory?: string;
}

interface CompressedImage {
  ref: string;
  size_bytes: number;
  ts: string;
}

const JSONL_CATEGORIES: ReadonlySet<string> = new Set([
  "send",
  "recv",
  "error",
  "worklog",
]);

export function LogsView({ logCategory }: Props) {
  const cat = useMemo(() => {
    return (
      LOG_CATEGORIES.find((c) => c.id === logCategory) ?? LOG_CATEGORIES[0]
    );
  }, [logCategory]);

  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [images, setImages] = useState<CompressedImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setImages(null);
    setError(null);
    (async () => {
      try {
        if (cat.id === "compressed") {
          const r = (await api.listCompressedImages()) as CompressedImage[];
          if (!cancelled) setImages(r);
        } else if (JSONL_CATEGORIES.has(cat.id)) {
          const r = await api.listLogEntries(cat.id as LogCategoryId, 500);
          if (!cancelled) setEntries(r);
        } else {
          if (!cancelled) setError(`unknown log category: ${cat.id}`);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cat]);

  return (
    <section className="logs-view">
      <header className="view-header">
        <h1>
          <span style={{ marginRight: 8 }}>{cat.emoji}</span>
          {cat.label}
        </h1>
        <p className="view-subtitle">{cat.subtitle}</p>
      </header>

      {error && <div className="log-empty">로그 읽기 실패: {error}</div>}
      {!error && entries === null && images === null && (
        <div className="log-empty">읽는 중…</div>
      )}

      {cat.id === "compressed" && images !== null && (
        <CompressedGallery images={images} />
      )}

      {entries !== null && <LogEntryList catId={cat.id} entries={entries} />}
    </section>
  );
}

function LogEntryList({ catId, entries }: { catId: string; entries: LogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="empty" style={{ padding: "40px 24px" }}>
        <div className="empty-icon">📭</div>
        <div className="empty-title">기록이 없어요</div>
      </div>
    );
  }
  return (
    <div className="log-list">
      {entries.map((e, i) => (
        <LogRow key={i} catId={catId} entry={e} />
      ))}
    </div>
  );
}

function LogRow({ catId, entry }: { catId: string; entry: LogEntry }) {
  const ev = entry.event ?? "";
  const cls =
    ev.includes("fail") || ev.includes("error")
      ? " log-row-error"
      : ev.includes("ok")
      ? " log-row-ok"
      : "";

  return (
    <div className={"log-row" + cls}>
      <div className="log-row-time">{fmtFull(entry.ts)}</div>
      <div className="log-row-main">
        {catId === "worklog" ? (
          <>
            <b>{entry.summary ?? ""}</b>
            {entry.detail && (
              <div className="log-detail">{entry.detail}</div>
            )}
          </>
        ) : (
          summaryLine(entry)
        )}
      </div>
    </div>
  );
}

function summaryLine(e: LogEntry): JSX.Element {
  const tid = e.transfer_id ? (
    <span className="log-mono"> {e.transfer_id}</span>
  ) : null;
  switch (e.event) {
    case "send_ok":
      return (
        <>
          📤 Send OK · {e.category ?? ""}
          {tid}
        </>
      );
    case "send_fail":
      return <>❌ Send failed · {e.stderr ?? ""}</>;
    case "verify_ok":
      return (
        <>
          ✅ Verify OK · {e.checked ?? 0} matched
          {tid}
        </>
      );
    case "verify_fail":
      return (
        <>
          ⚠ Verify mismatch {e.mismatches ?? 0} · missing {e.missing ?? 0}
          {tid}
        </>
      );
    case "verify_error":
      return <>❌ Verify error · {e.error ?? ""}</>;
    default:
      return <code>{JSON.stringify(e)}</code>;
  }
}

function CompressedGallery({ images }: { images: CompressedImage[] }) {
  if (images.length === 0) {
    return (
      <div className="empty" style={{ padding: "40px 24px" }}>
        <div className="empty-icon">🖼</div>
        <div className="empty-title">압축 보관된 이미지가 없어요</div>
        <div className="empty-hint">
          30일 지난 클립보드 이미지가 여기에 JPEG로 보관돼요.
        </div>
      </div>
    );
  }
  return (
    <div className="log-img-grid">
      {images.map((img) => (
        <CompressedTile key={img.ref} img={img} />
      ))}
    </div>
  );
}

function CompressedTile({ img }: { img: CompressedImage }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const abs = await api.compressedImagePath(img.ref);
        if (!cancelled) setSrc(convertFileSrc(abs));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [img.ref]);

  return (
    <figure className="log-img-tile" title={img.ref}>
      {src ? (
        <img src={src} alt={img.ref} loading="lazy" />
      ) : (
        <div className="log-img-loading">…</div>
      )}
      <figcaption>
        <span className="log-img-size">{fmtBytes(img.size_bytes)}</span>
        <span className="log-img-ts">{fmtFull(img.ts)}</span>
      </figcaption>
    </figure>
  );
}

function fmtFull(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
