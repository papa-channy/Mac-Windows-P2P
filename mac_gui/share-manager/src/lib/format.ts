// format.ts — display-time helpers. Logic mirrors windows_gui/share-manager/
// src/app.js prettyName / fmtBytes / fmtRelative / parseTransferName.

export interface ParsedTransfer {
  date: string;        // 2026-05-22
  categoryKey: string; // documents
  basename: string;
  version: string;     // "01"
  ext: string;         // ".html"  (includes leading dot or "")
}

/** Parse `YYYY-MM-DD__cat__base__vNN.ext` filename. */
export function parseTransferName(filename: string): ParsedTransfer | null {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})__([a-z_]+)__(.+?)__v(\d+)(\.[^.]+)?$/);
  if (!m) return null;
  return {
    date: m[1],
    categoryKey: m[2],
    basename: m[3],
    version: m[4],
    ext: m[5] ?? "",
  };
}

/** Display-friendly name: basename + extension. Falls back to raw. */
export function prettyName(filename: string): string {
  const p = parseTransferName(filename);
  return p ? p.basename + p.ext : filename;
}

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export function fmtRelative(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return iso.slice(0, 10);
}

export function fmtFull(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR");
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Icon emoji fallback by extension — used when no VSCode theme active. */
export function iconForExt(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["jpg","jpeg","png","gif","webp","heic","bmp","svg"].includes(ext)) return "🖼";
  if (["mp4","mov","mkv","avi","webm"].includes(ext)) return "🎬";
  if (["mp3","wav","flac","aac","ogg"].includes(ext)) return "🎵";
  if (["zip","7z","rar","tar","gz"].includes(ext)) return "🗜";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc","docx","hwp","hwpx"].includes(ext)) return "📘";
  if (["xls","xlsx","csv"].includes(ext)) return "📊";
  if (["ppt","pptx","key"].includes(ext)) return "📽";
  if (["md","txt","rtf"].includes(ext)) return "📝";
  if (["html","htm"].includes(ext)) return "🌐";
  if (["js","ts","tsx","jsx","rs","py","go","java","c","cpp","cs","rb","php","swift","kt","sh","ps1"].includes(ext))
    return "⌨";
  return "📄";
}

export function asciiForExt(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["pdf","doc","docx","txt","md","rtf","hwp","hwpx"].includes(ext)) return "D";
  if (["xls","xlsx","csv"].includes(ext)) return "S";
  if (["ppt","pptx","key"].includes(ext)) return "P";
  if (["jpg","jpeg","png","gif","webp","heic","bmp","svg"].includes(ext)) return "I";
  if (["mp4","mov","mkv","avi","webm"].includes(ext)) return "V";
  if (["mp3","wav","flac","aac","ogg"].includes(ext)) return "A";
  if (["zip","7z","rar","tar","gz"].includes(ext)) return "Z";
  return "F";
}
