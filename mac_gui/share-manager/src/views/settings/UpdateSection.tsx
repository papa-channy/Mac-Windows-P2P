// UpdateSection — Tauri auto-updater check + desktop alias management.
// Kept separate from the four "spec-driven" sections (tree/network/policy/
// appearance) because it's Mac-only.

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { checkForUpdateDetailed } from "../../lib/updater";
import { useToast } from "../../lib/toast";

export function UpdateSection() {
  const [aliasStatus, setAliasStatus] = useState<string>("…");
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const toast = useToast();

  useEffect(() => {
    api.currentAppVersion().then(setVersion);
    api.desktopAliasStatus().then((s) => setAliasStatus(s.status));
  }, []);

  const toggleAlias = async () => {
    try {
      if (aliasStatus === "healthy") {
        await api.removeDesktopAlias();
      } else {
        await api.installDesktopAlias();
      }
      const s = await api.desktopAliasStatus();
      setAliasStatus(s.status);
    } catch (e) {
      toast("바로가기 변경 실패: " + String(e), "error");
    }
  };

  const manualCheck = async () => {
    setChecking(true);
    setStatusMsg("확인 중…");
    const r = await checkForUpdateDetailed();
    setChecking(false);
    switch (r.kind) {
      case "up_to_date":
        setStatusMsg("최신 버전입니다.");
        break;
      case "available":
        setStatusMsg(`v${r.update.version} 사용 가능 — 메인 화면 배너 참조`);
        break;
      case "error":
        setStatusMsg(`확인 실패: ${r.message}`);
        break;
    }
  };

  return (
    <section className="settings-section">
      <h3>업데이트 / 배포</h3>

      <div className="settings-row">
        <div className="settings-label">현재 버전</div>
        <div className="settings-control">
          <span className="result-val">v{version}</span>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="primary-btn" onClick={manualCheck} disabled={checking}>
              {checking ? "확인 중…" : "지금 업데이트 확인"}
            </button>
          </div>
          {statusMsg && <span className="settings-hint">{statusMsg}</span>}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-label">바탕화면 바로가기</div>
        <div className="settings-control">
          <div className="btn-row">
            <button className="ghost-btn" onClick={toggleAlias}>
              {aliasStatus === "healthy" ? "제거" : "만들기"}
            </button>
            <span className="settings-hint">
              상태: <code>{aliasStatus}</code>
            </span>
          </div>
          <span className="settings-hint">
            <code>/Applications/share-manager.app</code> 으로 향하는 심볼릭 링크.
            자동 업데이트 후에도 항상 최신 버전을 가리켜요.
          </span>
        </div>
      </div>
    </section>
  );
}
