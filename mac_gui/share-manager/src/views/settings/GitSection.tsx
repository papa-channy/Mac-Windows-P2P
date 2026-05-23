// GitSection — Settings 페이지의 "Git / GitHub" 섹션. Wraps the two
// credential-management widgets (PAT + SSH). Lives inside SettingsView
// alongside Update / Tree / Network / Policy / Appearance.

import { TokenSettings } from "../../components/git/TokenSettings";
import { SshSettings } from "../../components/git/SshSettings";

export function GitSection() {
  return (
    <section className="settings-section">
      <header className="settings-section-head">
        <h3>Git / GitHub</h3>
        <p className="settings-section-sub">
          GitHub PAT (Personal Access Token) + SSH 키 관리. 둘 다 macOS 키체인 /
          ~/.ssh 에 저장 — 셰어에는 절대 게시되지 않습니다.
        </p>
      </header>
      <TokenSettings />
      <SshSettings />
    </section>
  );
}
