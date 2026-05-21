import { useState } from "react";
import type { AvailableUpdate } from "../lib/updater";

interface Props {
  update: AvailableUpdate;
  onDismiss: () => void;
}

export function UpdaterBanner({ update, onDismiss }: Props) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ d: number; t: number | null }>({
    d: 0,
    t: null,
  });

  const start = async () => {
    setInstalling(true);
    try {
      await update.install((d, t) => setProgress({ d, t }));
      // install() ends by relaunch() — execution typically stops here
    } catch (e) {
      console.error("update install failed:", e);
      setInstalling(false);
    }
  };

  const pct = progress.t ? Math.floor((progress.d / progress.t) * 100) : null;

  return (
    <div className="updater-banner">
      <span className="updater-emoji">⬆</span>
      <div className="updater-body">
        <div className="updater-line">
          새 버전 <strong>v{update.version}</strong> 이 준비됐어요
        </div>
        {installing && (
          <div className="updater-progress">
            {pct !== null ? `${pct}% 다운로드 중…` : "다운로드 중…"}
          </div>
        )}
      </div>
      {!installing && (
        <>
          <button className="primary" onClick={start}>
            지금 설치
          </button>
          <button className="ghost" onClick={onDismiss}>
            나중에
          </button>
        </>
      )}
    </div>
  );
}
