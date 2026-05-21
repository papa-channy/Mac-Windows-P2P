import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { checkForUpdate } from "../lib/updater";

export function SettingsView() {
  const [settings, setSettings] = useState<unknown>(null);
  const [policy, setPolicy] = useState<unknown>(null);
  const [profiles, setProfiles] = useState<unknown[]>([]);
  const [aliasStatus, setAliasStatus] = useState<string>("…");
  const [updateMsg, setUpdateMsg] = useState<string>("");
  const [version, setVersion] = useState<string>("");

  const refreshAlias = () =>
    api.desktopAliasStatus().then((s) => setAliasStatus(s.status));

  useEffect(() => {
    api.loadSettings().then(setSettings);
    api.loadPolicy().then(setPolicy).catch(() => setPolicy(null));
    api.listProfiles().then(setProfiles).catch(() => setProfiles([]));
    api.currentAppVersion().then(setVersion);
    refreshAlias();
  }, []);

  const toggleAlias = async () => {
    if (aliasStatus === "healthy") {
      await api.removeDesktopAlias();
    } else {
      await api.installDesktopAlias();
    }
    await refreshAlias();
  };

  const manualUpdateCheck = async () => {
    setUpdateMsg("확인 중…");
    const u = await checkForUpdate();
    if (!u) {
      setUpdateMsg("최신 버전입니다.");
      return;
    }
    setUpdateMsg(`v${u.version} 사용 가능. 메인 화면 배너에서 설치하세요.`);
  };

  return (
    <section className="view view-settings">
      <header className="view-header">
        <h1>설정</h1>
        <span className="modal-meta">v{version}</span>
      </header>

      <details open>
        <summary>업데이트 / 배포</summary>
        <div style={{ padding: "8px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={manualUpdateCheck}>지금 업데이트 확인</button>
          <span className="modal-meta">{updateMsg}</span>
        </div>
        <div style={{ padding: "8px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <span>바탕화면 바로가기: <code>{aliasStatus}</code></span>
          <button onClick={toggleAlias}>
            {aliasStatus === "healthy" ? "제거" : "만들기"}
          </button>
        </div>
        <p className="modal-meta">
          바로가기는 <code>/Applications/share-manager.app</code> 으로 향하는 심볼릭 링크라
          자동 업데이트 후에도 항상 최신 버전을 열어요.
        </p>
      </details>

      <details>
        <summary>내 프로필 / 정책</summary>
        <div style={{ padding: "8px 0" }}>
          <button onClick={() => api.publishProfile()}>내 프로필 게시</button>
        </div>
        <pre>{JSON.stringify(policy, null, 2)}</pre>
        <pre>{JSON.stringify(profiles, null, 2)}</pre>
      </details>

      <details>
        <summary>Settings (raw)</summary>
        <pre>{JSON.stringify(settings, null, 2)}</pre>
      </details>
    </section>
  );
}
