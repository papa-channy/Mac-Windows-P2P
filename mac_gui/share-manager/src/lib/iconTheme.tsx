// iconTheme.tsx — VSCode icon theme resolver, ported from
// windows_gui/share-manager/src/app.js (resolveThemeIconPath +
// renderIconHtml, app.js:336–436).
//
// Reactively reloads the active theme when settings.appearance.icon_theme
// changes. Falls back to emoji or ASCII for built-in themes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useSettings } from "./settings";
import { iconForExt, asciiForExt } from "./format";

// ─── Theme JSON shapes ─────────────────────────────────────────────

interface IconDefinition {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
}

interface IconThemeDef {
  iconDefinitions?: Record<string, IconDefinition>;
  fileNames?: Record<string, string>;       // exact filename → icon id
  fileExtensions?: Record<string, string>;  // ext (no dot) → icon id
  folderNames?: Record<string, string>;     // exact folder name → icon id
  file?: string;                             // default file icon id
  folder?: string;                           // default folder icon id
}

interface LoadedTheme {
  baseDir: string;
  def: IconThemeDef;
}

// ─── Resolution result ─────────────────────────────────────────────

export type IconResult =
  | { kind: "themed"; url: string }
  | { kind: "emoji"; char: string }
  | { kind: "ascii"; char: string };

interface IconThemeCtx {
  resolveIcon: (filename: string, isDir: boolean) => IconResult;
  /** Category folder candidates for sidebar icons. */
  resolveCategoryIcon: (categoryKey: string) => IconResult;
  /** Current selection: "default" | "ascii" | <installed-id>. */
  themeId: string;
}

const Ctx = createContext<IconThemeCtx>({
  resolveIcon: (n, isDir) => ({ kind: "emoji", char: isDir ? "📁" : iconForExt(n) }),
  resolveCategoryIcon: () => ({ kind: "emoji", char: "📁" }),
  themeId: "default",
});

export function useIconTheme() {
  return useContext(Ctx);
}

// ─── Category → likely VSCode folder names ─────────────────────────
// Mirror app.js CATEGORY_FOLDER_CANDIDATES.

const CATEGORY_FOLDER_CANDIDATES: Record<string, string[]> = {
  documents:    ["documents", "docs", "documentation"],
  data:         ["data", "database", "db"],
  repos:        ["src", "source", "sources", "repo", "repository"],
  research:     ["research", "papers", "notes", "docs"],
  env:          ["config", "configs", "environment", "environments", "env"],
  builds:       ["dist", "build", "builds", "output", "out"],
  assets:       ["assets", "asset", "resources", "resource"],
  misc:         ["misc", "other", "others", "sandbox"],
  unclassified: ["inbox", "temp", "tmp", "staging", "misc"],
};

// ─── Path join (cross-platform, normalize ./.. ) ───────────────────

function joinPath(base: string, rel: string): string {
  const combined = (base + "/" + rel).replace(/\\/g, "/");
  const result: string[] = [];
  for (const p of combined.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") { if (result.length) result.pop(); continue; }
    result.push(p);
  }
  return result.join("/");
}

// ─── Core resolver — pure function over loaded theme ───────────────

function resolveInTheme(
  theme: LoadedTheme,
  filename: string,
  isDir: boolean,
): string | null {
  const def = theme.def;
  const lower = filename.toLowerCase();

  let iconId: string | undefined;
  if (isDir) {
    iconId = def.folderNames?.[lower] ?? def.folder;
  } else {
    if (def.fileNames?.[lower]) {
      iconId = def.fileNames[lower];
    } else if (def.fileExtensions) {
      // Try progressively shorter extensions from leftmost dot
      let dot = lower.indexOf(".");
      while (dot !== -1 && dot < lower.length - 1) {
        const ext = lower.substring(dot + 1);
        if (def.fileExtensions[ext]) { iconId = def.fileExtensions[ext]; break; }
        dot = lower.indexOf(".", dot + 1);
      }
    }
    if (!iconId) iconId = def.file;
  }
  if (!iconId) return null;

  const entry = def.iconDefinitions?.[iconId];
  if (!entry?.iconPath) return null;

  return joinPath(theme.baseDir, entry.iconPath);
}

// ─── Provider ──────────────────────────────────────────────────────

export function IconThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const themeId = settings.appearance.icon_theme;
  const [loaded, setLoaded] = useState<LoadedTheme | null>(null);

  // Re-load theme JSON whenever the active id changes
  useEffect(() => {
    let cancelled = false;
    if (themeId === "default" || themeId === "ascii") {
      setLoaded(null);
      return;
    }
    const installed = settings.appearance.icon_themes.find((t) => t.id === themeId);
    if (!installed) {
      setLoaded(null);
      return;
    }
    (async () => {
      try {
        const res = await invoke<{ base_dir: string; definition: IconThemeDef }>(
          "load_icon_theme_def",
          { themeJsonPath: installed.theme_json_path },
        );
        if (!cancelled) setLoaded({ baseDir: res.base_dir, def: res.definition });
      } catch (e) {
        console.warn("load_icon_theme_def failed:", e);
        if (!cancelled) setLoaded(null);
      }
    })();
    return () => { cancelled = true; };
  }, [themeId, settings.appearance.icon_themes]);

  const resolveIcon = useCallback(
    (filename: string, isDir: boolean): IconResult => {
      if (loaded) {
        const p = resolveInTheme(loaded, filename, isDir);
        if (p) return { kind: "themed", url: convertFileSrc(p) };
      }
      if (themeId === "ascii") {
        return { kind: "ascii", char: isDir ? "D" : asciiForExt(filename) };
      }
      return { kind: "emoji", char: isDir ? "📁" : iconForExt(filename) };
    },
    [loaded, themeId],
  );

  const resolveCategoryIcon = useCallback(
    (categoryKey: string): IconResult => {
      if (loaded) {
        for (const name of CATEGORY_FOLDER_CANDIDATES[categoryKey] ?? []) {
          const p = resolveInTheme(loaded, name, true);
          if (p) return { kind: "themed", url: convertFileSrc(p) };
        }
        const fallback = resolveInTheme(loaded, "", true);
        if (fallback) return { kind: "themed", url: convertFileSrc(fallback) };
      }
      return { kind: "emoji", char: "📁" };
    },
    [loaded],
  );

  const value = useMemo<IconThemeCtx>(
    () => ({ resolveIcon, resolveCategoryIcon, themeId }),
    [resolveIcon, resolveCategoryIcon, themeId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
