// PreviewPanel — file content preview for the DetailsModal.
//
// Extension-keyed routing:
//   image     (png/jpg/gif/webp/svg/bmp/ico)  → <img> via convertFileSrc
//   pdf                                       → <iframe> via convertFileSrc
//   text-ish  (md/txt/json/yaml/log/source)   → <pre>, capped at 256 KB
//   other                                     → "preview unavailable"
//
// Directories are short-circuited at the top — they don't get a
// preview, the user is sent to Reveal.

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type FilePreview, type TransferItem } from "../lib/api";
import { fmtBytes } from "../lib/format";

const IMG_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "heic",
]);
const PDF_EXT = new Set(["pdf"]);
// Anything in TEXT_EXT goes through read_file_preview. Anything else
// + non-image / non-pdf falls back to "preview unavailable".
const TEXT_EXT = new Set([
  // docs
  "txt", "md", "markdown", "rst",
  // structured data
  "json", "jsonl", "yaml", "yml", "toml", "ini", "conf", "cfg", "env",
  // logs
  "log",
  // source
  "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "kt", "swift",
  "c", "h", "cpp", "hpp", "cs", "rb", "php", "lua", "sh", "bash", "zsh", "fish",
  "css", "scss", "less", "html", "htm", "xml", "svg",
  "sql", "graphql", "proto",
  "csv", "tsv",
]);

interface Props {
  item: TransferItem;
}

export function PreviewPanel({ item }: Props) {
  if (item.is_dir) {
    return (
      <div className="preview-empty">
        📁 디렉토리 — "Finder에서 보기" 로 열어주세요.
      </div>
    );
  }

  const ext = item.path
    .toLowerCase()
    .replace(/^.*\./, "")
    .replace(/[^a-z0-9]/g, "");
  const kind: "image" | "pdf" | "text" | "other" = IMG_EXT.has(ext)
    ? "image"
    : PDF_EXT.has(ext)
    ? "pdf"
    : TEXT_EXT.has(ext)
    ? "text"
    : "other";

  return (
    <div className="preview-panel">
      <div className="preview-head">
        <span className="preview-kind">미리보기 · {kind}</span>
        <span className="preview-size">{fmtBytes(item.size_bytes)}</span>
      </div>
      {kind === "image" && <ImagePreview path={item.path} />}
      {kind === "pdf" && <PdfPreview path={item.path} />}
      {kind === "text" && <TextPreview path={item.path} ext={ext} />}
      {kind === "other" && <OtherPreview ext={ext} />}
    </div>
  );
}

function ImagePreview({ path }: { path: string }) {
  const src = convertFileSrc(path);
  return (
    <div className="preview-image-wrap">
      <img className="preview-image" src={src} alt={path} loading="lazy" />
    </div>
  );
}

function PdfPreview({ path }: { path: string }) {
  const src = convertFileSrc(path);
  return (
    <div className="preview-pdf-wrap">
      <iframe className="preview-pdf" src={src} title={path} />
    </div>
  );
}

function TextPreview({ path, ext }: { path: string; ext: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; data: FilePreview }
    | { kind: "err"; msg: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .readFilePreview(path, 256 * 1024)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: "ok", data });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ kind: "err", msg: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state.kind === "loading") {
    return <div className="preview-empty">읽는 중…</div>;
  }
  if (state.kind === "err") {
    return <div className="preview-empty">읽기 실패: {state.msg}</div>;
  }
  const { data } = state;
  if (data.binary) {
    return (
      <div className="preview-empty">
        바이너리 파일 — 텍스트 미리보기 불가 ({fmtBytes(data.size_bytes)}).
      </div>
    );
  }
  return (
    <>
      <pre className={"preview-text preview-lang-" + ext}>{data.text}</pre>
      {data.truncated && (
        <div className="preview-trunc">
          ⚠ 256 KB 까지만 표시 (전체 {fmtBytes(data.size_bytes)}). 전체는
          "열기" / "Finder에서 보기" 로.
        </div>
      )}
    </>
  );
}

function OtherPreview({ ext }: { ext: string }) {
  return (
    <div className="preview-empty">
      미리보기 미지원 형식 (.{ext || "<none>"}) — "열기" 로 외부 앱에서 보기.
    </div>
  );
}
