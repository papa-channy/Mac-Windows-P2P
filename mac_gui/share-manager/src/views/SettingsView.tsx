// SettingsView — 5 sections, each backed by useSettings (auto-persist) or
// separate Tauri commands. Layout matches windows_gui/share-manager/src/
// index.html:150–262 with the addition of "업데이트 / 배포" (Mac-only).

import { UpdateSection } from "./settings/UpdateSection";
import { TreeSection } from "./settings/TreeSection";
import { NetworkSection } from "./settings/NetworkSection";
import { PolicySection } from "./settings/PolicySection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { GitSection } from "./settings/GitSection";

export function SettingsView() {
  return (
    <section className="panel">
      <header className="main-header">
        <div>
          <h2>⚙ 설정</h2>
          <div className="subtitle">앱 동작과 외관 — 변경 즉시 자동 저장</div>
        </div>
      </header>
      <div className="settings-body">
        <UpdateSection />
        <TreeSection />
        <NetworkSection />
        <PolicySection />
        <GitSection />
        <AppearanceSection />
      </div>
    </section>
  );
}
