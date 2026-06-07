// ClipboardView — 양쪽 OS 클립보드를 좌우 2컬럼으로 분리한 카드 타임라인.
//
// 레이아웃: 화면을 좌우로 나눠 한쪽은 상대(remote) OS, 한쪽은 내(local)
// OS 클립보드. 규칙은 "상대가 왼쪽, 나는 오른쪽" — Mac에서 보면
// 좌=Windows / 우=Mac, Windows에서 보면 좌=Mac / 우=Windows. 각 컬럼은
// 독립적으로 newest-first 라서 OS 분리와 시간순 정렬을 동시에 만족한다.
// (sticky 공유텍스트 패널은 v0.3.3에서 제거 — Notes가 그 역할. E-8-b dep.)

import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, type ClipboardEntry, type ClipboardImageEntry } from "../lib/api";
import { useToast } from "../lib/toast";
import { fmtRelative } from "../lib/format";
import { useShareTopic } from "../lib/useShareTopic";

type Os = "macos" | "windows";

/** Tauri webview의 navigator는 호스트 OS를 반영한다. Mac 빌드는 macos,
 *  Windows 미러 빌드는 windows를 반환 — 좌우 배치가 자동으로 뒤집힌다. */
function detectLocalOs(): Os {
  if (typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent)) {
    return "windows";
  }
  return "macos";
}

function osShort(os: Os): string {
  return os === "macos" ? "Mac" : "Win";
}

function osLabel(os: Os, isLocal: boolean): string {
  const name = os === "macos" ? "Mac" : "Windows";
  return isLocal ? `내 클립보드 · ${name}` : `${name} 클립보드`;
}

function isUrl(s: string): boolean {
  const t = s.trim();
  return /^https?:\/\/\S+$/i.test(t) || /^www\.\S+$/i.test(t);
}

export function ClipboardView() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const toast = useToast();
  const localOs = detectLocalOs();
  const remoteOs: Os = localOs === "macos" ? "windows" : "macos";

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

  const onCopy = async (e: ClipboardEntry) => {
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

  // OS 2분법으로 분리. macos/windows 외 값(이론상 없음)은 내 쪽으로 귀속.
  const remoteEntries = entries.filter((e) => e.os === remoteOs);
  const localEntries = entries.filter((e) => e.os !== remoteOs);

  return (
    <section className="panel">
      <header className="main-header">
        <div>
          <h2>📋 클립보드 (양쪽 통합)</h2>
          <div className="subtitle">
            양쪽 호스트가 OS 클립보드를 1.5초마다 자동 기록 · 좌측은 상대 OS,
            우측은 내 OS · 카드 클릭 → 내 클립보드로 복사
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

      <div className="clip-os-split">
        <ClipColumn os={remoteOs} isLocal={false} entries={remoteEntries} onCopy={onCopy} />
        <ClipColumn os={localOs} isLocal={true} entries={localEntries} onCopy={onCopy} />
      </div>
    </section>
  );
}

function ClipColumn({
  os,
  isLocal,
  entries,
  onCopy,
}: {
  os: Os;
  isLocal: boolean;
  entries: ClipboardEntry[];
  onCopy: (e: ClipboardEntry) => void;
}) {
  const osClass = os === "macos" ? "clip-entry-os-mac" : "clip-entry-os-win";
  return (
    <div className={"clip-col" + (isLocal ? " local" : " remote")}>
      <header className="clip-col-head">
        <span className={"clip-entry-os " + osClass}>{osShort(os)}</span>
        <span className="clip-col-title">{osLabel(os, isLocal)}</span>
        <span className="clip-col-count">{entries.length}건</span>
      </header>
      {entries.length === 0 ? (
        <div className="clip-col-empty">
          {isLocal
            ? "내 클립보드 기록이 없어요. 복사하면 여기 쌓여요."
            : "상대 호스트 기록이 없어요."}
        </div>
      ) : (
        <div className="clip-col-body">
          {entries.map((e, i) =>
            e.kind === "image" ? (
              <ImageCard key={i} entry={e} onClick={() => onCopy(e)} />
            ) : (
              <TextCard key={i} entry={e} onClick={() => onCopy(e)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function CardHead({ entry }: { entry: ClipboardEntry }) {
  return (
    <div className="clip-card-head">
      <span className="clip-card-host">{entry.host}</span>
      <span className="clip-card-time">{fmtRelative(entry.ts)}</span>
    </div>
  );
}

function TextCard({ entry, onClick }: { entry: ClipboardEntry; onClick: () => void }) {
  const text = entry.content.slice(0, 600);
  const url = isUrl(text);
  return (
    <button className="clip-card" onClick={onClick} title="클릭 → 내 클립보드로 복사">
      <CardHead entry={entry} />
      <div className={"clip-card-text" + (url ? " url" : "")}>{text}</div>
    </button>
  );
}

function ImageCard({
  entry,
  onClick,
}: {
  entry: ClipboardImageEntry;
  onClick: () => void;
}) {
  const [src, setSrc] = useState("");
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
    <button
      className="clip-card clip-card-image"
      onClick={onClick}
      title="클릭 → 내 클립보드로 복사"
    >
      <CardHead entry={entry} />
      {src ? (
        <img className="clip-card-thumb" src={src} alt="clipboard image" />
      ) : (
        <div className="clip-card-missing">이미지 로드 실패 / 만료됨</div>
      )}
      <span className="clip-card-imgmeta">
        {entry.width} × {entry.height} · {kb} KB
      </span>
    </button>
  );
}
