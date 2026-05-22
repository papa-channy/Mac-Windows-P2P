import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { checkForUpdateDetailed } from "../../lib/updater";
import { useToast } from "../../lib/toast";
import { PermissionsOnboarding } from "../../components/PermissionsOnboarding";

const PERMS_ONBOARDED_KEY = "share-manager.permissions_onboarded";

export function UpdateSection() {
  const [aliasStatus, setAliasStatus] = useState<string>("…");
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [fdaStatus, setFdaStatus] = useState<"unknown" | "yes" | "no">("unknown");
  const [showPerms, setShowPerms] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.currentAppVersion().then(setVersion);
    api.desktopAliasStatus().then((s) => setAliasStatus(s.status));
    api.hasFullDiskAccess().then((ok) => setFdaStatus(ok ? "yes" : "no"));
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

  const reshowPerms = () => {
    // Drop the "already onboarded" cookie so the auto-open path also
    // works on the next launch, then trigger the modal immediately
    // for this session.
    localStorage.removeItem(PERMS_ONBOARDED_KEY);
    setShowPerms(true);
  };

  const refreshFda = async () => {
    const ok = await api.hasFullDiskAccess();
    setFdaStatus(ok ? "yes" : "no");
    toast(ok ? "✓ 전체 디스크 접근 ON" : "✗ 아직 OFF", ok ? "success" : "error");
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

      <div className="settings-row">
        <div className="settings-label">전체 디스크 권한</div>
        <div className="settings-control">
          <div className="btn-row">
            <button className="primary-btn" onClick={reshowPerms}>
              🔓 권한 안내 다시 보기
            </button>
            <button className="ghost-btn" onClick={refreshFda}>
              상태 새로고침
            </button>
            <span className="settings-hint">
              상태:{" "}
              <code>
                {fdaStatus === "yes"
                  ? "✓ ON"
                  : fdaStatus === "no"
                  ? "✗ OFF"
                  : "…"}
              </code>
            </span>
          </div>
          <span className="settings-hint">
            ON 이면 데스크탑·Documents·외장 드라이브·셰어 폴더에 권한 prompt 없이 접근.
            안 켜도 동작은 하지만 폴더마다 macOS 가 매번 허용을 물어봐요.
          </span>
        </div>
      </div>

      <PermissionsOnboarding
        isOpen={showPerms}
        onClose={() => {
          localStorage.setItem(PERMS_ONBOARDED_KEY, "1");
          setShowPerms(false);
          api.hasFullDiskAccess().then((ok) => setFdaStatus(ok ? "yes" : "no"));
        }}
      />
    </section>
  );
}
