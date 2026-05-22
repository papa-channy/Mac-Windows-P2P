// AppearanceSection — icon theme radio (default / ascii / installed) +
// VSCode theme installer.
//
// The actual theme loading + per-file icon resolution lives in Phase E
// (lib/iconTheme.ts). This section just manages the catalog stored in
// settings.appearance.

import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useSettings, type IconTheme } from "../../lib/settings";
import { useToast } from "../../lib/toast";

interface Built {
  id: string;
  name: string;
  meta: string;
}

const BUILT_INS: Built[] = [
  { id: "default", name: "기본 (이모지)", meta: "별도 설치 없이 즉시" },
  { id: "ascii",   name: "ASCII (단순 문자)", meta: "정렬 위주" },
];

export function AppearanceSection() {
  const { settings, update } = useSettings();
  const toast = useToast();

  const selectTheme = (id: string) =>
    update((s) => ({ ...s, appearance: { ...s.appearance, icon_theme: id } }));

  const removeTheme = (id: string) =>
    update((s) => ({
      ...s,
      appearance: {
        ...s.appearance,
        icon_theme:
          s.appearance.icon_theme === id ? "default" : s.appearance.icon_theme,
        icon_themes: s.appearance.icon_themes.filter((t) => t.id !== id),
      },
    }));

  const installTheme = async () => {
    try {
      const picked = await pickFolder({
        multiple: false,
        directory: true,
        title: "VSCode 아이콘 테마 폴더 선택",
      });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      const theme = await invoke<IconTheme>("install_icon_theme", { folder: path });
      await update((s) => {
        const existing = s.appearance.icon_themes.filter((t) => t.id !== theme.id);
        return {
          ...s,
          appearance: {
            ...s.appearance,
            icon_themes: [...existing, theme],
            icon_theme: theme.id,
          },
        };
      });
      toast(`아이콘 테마 추가: ${theme.name} (${theme.icon_count}개)`, "success");
    } catch (e) {
      toast("아이콘 테마 설치 실패: " + String(e), "error");
    }
  };

  return (
    <section className="settings-section">
      <h3>외관</h3>

      <div className="settings-row">
        <div className="settings-label">아이콘 테마</div>
        <div className="settings-control">
          <div className="theme-options">
            {BUILT_INS.map((b) => (
              <label className="theme-opt" key={b.id}>
                <input
                  type="radio"
                  name="icon-theme"
                  value={b.id}
                  checked={settings.appearance.icon_theme === b.id}
                  onChange={() => selectTheme(b.id)}
                />
                <span className="theme-opt-name">{b.name}</span>
                <span className="theme-opt-meta">{b.meta}</span>
              </label>
            ))}
            {settings.appearance.icon_themes.map((t) => (
              <label className="theme-opt" key={t.id}>
                <input
                  type="radio"
                  name="icon-theme"
                  value={t.id}
                  checked={settings.appearance.icon_theme === t.id}
                  onChange={() => selectTheme(t.id)}
                />
                <span className="theme-opt-name">{t.name}</span>
                <span className="theme-opt-meta">아이콘 {t.icon_count}개</span>
                <button
                  className="theme-opt-remove"
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm(`아이콘 테마 "${t.name}" 제거할까요?`)) removeTheme(t.id);
                  }}
                >
                  제거
                </button>
              </label>
            ))}
          </div>
          <button className="ghost-btn" onClick={installTheme}>
            📂 VSCode 아이콘 테마 추가
          </button>
          <span className="settings-hint">
            VSCode 마켓플레이스에서 받은 <b>Catppuccin Icons</b>, <b>Material Icon Theme</b> 등의
            확장 폴더를 추가하세요. 폴더 안에서 <code>icon-theme.json</code>을 자동으로 찾아요.
            <br />(VSIX는 ZIP으로 풀어서 <code>extension/</code> 폴더를 추가)
          </span>
        </div>
      </div>
    </section>
  );
}
