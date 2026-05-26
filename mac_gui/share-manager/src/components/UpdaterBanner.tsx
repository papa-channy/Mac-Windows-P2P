// UpdaterBanner — surface a new release and let the user install it.
//
// Tauri's auto-installer (downloadAndInstall + relaunch) is the primary
// path. It's not always reliable on macOS — the .app self-replace can
// silent-fail when the running binary holds a lock, or when Gatekeeper
// reattaches a quarantine attr to the unpacked .app. We don't pretend
// to fully debug that here; instead we always expose a "DMG 직접 다운로드"
// secondary action so the user can fall back to drag-install in one
// click, and elevate it to the primary CTA when an install error has
// just been recorded.

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { AvailableUpdate } from "../lib/updater";
import { useToast } from "../lib/toast";

interface Props {
  update: AvailableUpdate;
  onDismiss: () => void;
}

const REPO = "papa-channy/Mac-Windows-P2P";

function dmgUrl(version: string): string {
  return `https://github.com/${REPO}/releases/download/v${version}/mac-window-share-${version}.dmg`;
}

function releasesPageUrl(version: string): string {
  return `https://github.com/${REPO}/releases/tag/v${version}`;
}

export function UpdaterBanner({ update, onDismiss }: Props) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ d: number; t: number | null }>({
    d: 0,
    t: null,
  });
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const start = async () => {
    setInstalling(true);
    setError(null);
    try {
      await update.install((d, t) => setProgress({ d, t }));
      // If we get here without throwing, the in-process relaunch
      // should have replaced the binary. If the banner is still on
      // screen the next render will see version == update.version and
      // App.tsx will null it out.
    } catch (e) {
      const msg = String(e);
      console.error("update install failed:", e);
      setError(msg);
      toast(`업데이트 자동 설치 실패: ${msg}`, "error");
      setInstalling(false);
    }
  };

  const openDmg = async () => {
    try {
      const url = dmgUrl(update.version);
      // Prefer Tauri's opener (so the browser launch survives WebView
      // sandboxing) — falls back to window.open which works in dev.
      const opener = (window as unknown as {
        __TAURI__?: { opener?: { openUrl?: (u: string) => Promise<void> } };
      }).__TAURI__?.opener;
      if (opener?.openUrl) {
        await opener.openUrl(url);
      } else {
        window.open(url, "_blank");
      }
      toast("DMG 다운로드 시작 — 마운트 후 share-manager.app 을 /Applications 에 drag", "info");
    } catch (e) {
      toast(`DMG 다운로드 열기 실패: ${e}`, "error");
    }
  };

  const openReleasesPage = () => {
    const url = releasesPageUrl(update.version);
    const opener = (window as unknown as {
      __TAURI__?: { opener?: { openUrl?: (u: string) => Promise<void> } };
    }).__TAURI__?.opener;
    if (opener?.openUrl) {
      opener.openUrl(url).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
  };

  const pct = progress.t ? Math.floor((progress.d / progress.t) * 100) : null;
  const hadError = error !== null;

  return (
    <div className="updater-banner">
      <span className="updater-emoji">⬆</span>
      <div className="updater-body">
        <div>
          새 버전 <strong>v{update.version}</strong> 이 준비됐어요
          {!installing && !hadError && (
            <button
              type="button"
              className="updater-notes-link"
              onClick={openReleasesPage}
              title="GitHub Releases 페이지에서 changelog 보기"
            >
              릴리스 노트 <ExternalLink size={10} />
            </button>
          )}
        </div>
        {installing && (
          <div className="updater-progress">
            {pct !== null ? `${pct}% 다운로드 중…` : "다운로드 중…"}
          </div>
        )}
        {hadError && (
          <div className="updater-progress" style={{ color: "#c41818", marginTop: 4 }}>
            ✗ 자동 설치 실패. <b>DMG 직접 다운로드</b> 로 수동 설치하세요.
          </div>
        )}
      </div>
      {!installing && (
        <>
          {hadError ? (
            <>
              <button
                type="button"
                className="primary-btn"
                onClick={openDmg}
                title={`mac-window-share-${update.version}.dmg 다운로드 → 마운트 → /Applications 에 drag`}
              >
                ⬇ DMG 다운로드
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={start}
                title="자동 설치 다시 시도"
              >
                재시도
              </button>
            </>
          ) : (
            <>
              <button type="button" className="primary-btn" onClick={start}>
                지금 설치
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={openDmg}
                title="자동 설치 대신 DMG 받아서 수동 설치"
              >
                ⬇ DMG
              </button>
            </>
          )}
          <button type="button" className="ghost-btn" onClick={onDismiss}>
            {hadError ? "닫기" : "나중에"}
          </button>
        </>
      )}
    </div>
  );
}
