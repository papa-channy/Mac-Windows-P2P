// AppearanceSection — icon theme radio (default / ascii / installed) +
// installers:
//   • 📂 폴더에서 추가   — existing flow (user picks a VSCode ext folder)
//   • 📥 GitHub URL      — git clone --depth 1 into cache, then install
//   • Built-in catalog buttons for the popular themes the Windows side uses
//
// Themes installed via either path land in settings.appearance.icon_themes
// so the IconThemeProvider picks them up immediately.

import { useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { api } from "../../lib/api";
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

interface CatalogEntry {
  label: string;
  /** sanitized cache subdir name */
  slug: string;
  /** Marketplace VSIX direct download (pre-built — no npm/build needed). */
  vsix: string;
  blurb: string;
}

/** Marketplace-hosted VSIX direct download URLs. Format:
 *    https://marketplace.visualstudio.com/_apis/public/gallery/
 *      publishers/<pub>/vsextensions/<ext>/latest/vspackage
 *  These always resolve to the most recent published build, so the user
 *  doesn't have to pin a version. */
const CATALOG: CatalogEntry[] = [
  {
    label: "Material Icon Theme",
    slug: "material-icon-theme",
    vsix: "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/PKief/vsextensions/material-icon-theme/latest/vspackage",
    blurb: "VSCode 표준 — 1200+ 아이콘",
  },
  {
    label: "Catppuccin Icons",
    slug: "catppuccin-vsc-icons",
    vsix: "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/Catppuccin/vsextensions/catppuccin-vsc-icons/latest/vspackage",
    blurb: "Mocha / Latte / Frappé / Macchiato 4종 동시 포함",
  },
  {
    label: "Symbols",
    slug: "symbols",
    vsix: "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/miguelsolorio/vsextensions/symbols/latest/vspackage",
    blurb: "단색 미니멀",
  },
  {
    label: "vscode-icons",
    slug: "vscode-icons",
    vsix: "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/vscode-icons-team/vsextensions/vscode-icons/latest/vspackage",
    blurb: "오리지널 VSCode 아이콘 팩",
  },
];

export function AppearanceSection() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState<string>("");
  const [gitUrl, setGitUrl] = useState<string>("");

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

  const adoptTheme = async (theme: IconTheme) => {
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
  };

  const installFromFolder = async () => {
    try {
      const picked = await pickFolder({
        multiple: false,
        directory: true,
        title: "VSCode 아이콘 테마 폴더 선택",
      });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      setBusy("folder");
      const theme = await api.installIconTheme(path);
      await adoptTheme(theme);
    } catch (e) {
      toast("아이콘 테마 설치 실패: " + String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const installFromGit = async (url: string) => {
    if (!url) return;
    setBusy(url);
    try {
      const theme = await api.installIconThemeFromGit(url);
      await adoptTheme(theme);
      setGitUrl("");
    } catch (e) {
      toast("git clone / 설치 실패: " + String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const installFromVsix = async (entry: CatalogEntry) => {
    setBusy(entry.slug);
    try {
      const theme = await api.installIconThemeFromVsix(entry.vsix, entry.slug);
      await adoptTheme(theme);
    } catch (e) {
      toast(`${entry.label} 다운로드 실패: ` + String(e), "error");
    } finally {
      setBusy("");
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
          <div className="btn-row">
            <button className="ghost-btn" onClick={installFromFolder} disabled={!!busy}>
              📂 폴더에서 추가
            </button>
          </div>
          <span className="settings-hint">
            로컬에 이미 받아둔 VSCode 확장 폴더 (icon-theme.json 포함) 를 그대로 선택.
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-label">GitHub 에서 추가</div>
        <div className="settings-control">
          <div className="path-row">
            <input
              type="text"
              className="text-input"
              placeholder="https://github.com/owner/repo"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              disabled={!!busy}
            />
            <button
              className="primary-btn"
              onClick={() => installFromGit(gitUrl)}
              disabled={!!busy || !gitUrl}
            >
              {busy === gitUrl ? "받는 중…" : "📥 받기"}
            </button>
          </div>
          <div className="theme-options">
            {CATALOG.map((c) => (
              <div className="theme-opt" key={c.slug}>
                <span className="theme-opt-name">{c.label}</span>
                <span className="theme-opt-meta">{c.blurb}</span>
                <button
                  className="theme-opt-remove"
                  onClick={(e) => {
                    e.preventDefault();
                    installFromVsix(c);
                  }}
                  disabled={!!busy}
                  title={c.vsix}
                >
                  {busy === c.slug ? "받는 중…" : "받기"}
                </button>
              </div>
            ))}
          </div>
          <span className="settings-hint">
            카탈로그 항목은 <b>VS Marketplace VSIX</b> 직접 다운로드 — 빌드된 산출물이라 즉시 적용.
            URL 입력란은 임의 GitHub repo (소스 트리에 <code>icon-theme.json</code> 가 있는 경우만) <code>git clone</code>.
          </span>
        </div>
      </div>
    </section>
  );
}
