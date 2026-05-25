// settings.tsx — strongly typed mirror of mac_gui/share-manager/src-tauri/
// src/share.rs Settings struct, plus a Context so TreeView (reads depth +
// shortcuts) and SettingsView (writes) stay in sync without duplicate
// load_settings calls.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ShortcutEntry {
  name: string;
  path: string;
}

export interface IconTheme {
  id: string;
  name: string;
  root_path: string;
  theme_json_path: string;
  icon_count: number;
}

export interface NotificationSettings {
  enabled: boolean;
  native: boolean;
  webhook_url: string;
  on_send_ok: boolean;
  on_send_fail: boolean;
  on_verify_fail: boolean;
  on_verify_ok: boolean;
  on_clipboard: boolean;
}

export interface AppSettings {
  schema_version: number;
  tree: {
    max_depth: number;
    shortcuts: ShortcutEntry[];
  };
  network: {
    remote_host: string;
  };
  appearance: {
    icon_theme: string;        // "default" | "ascii" | <id>
    icon_themes: IconTheme[];
    icon_theme_path?: string | null;
  };
  notifications: NotificationSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schema_version: 1,
  tree: { max_depth: 4, shortcuts: [] },
  network: { remote_host: "192.168.50.1" },
  appearance: { icon_theme: "default", icon_themes: [], icon_theme_path: null },
  notifications: {
    enabled: false,
    native: true,
    webhook_url: "",
    on_send_ok: true,
    on_send_fail: true,
    on_verify_fail: true,
    on_verify_ok: false,
    on_clipboard: false,
  },
};

function mergeWithDefaults(raw: unknown): AppSettings {
  const r = (raw ?? {}) as Partial<AppSettings>;
  return {
    schema_version: r.schema_version ?? DEFAULT_SETTINGS.schema_version,
    tree: { ...DEFAULT_SETTINGS.tree, ...(r.tree ?? {}) },
    network: { ...DEFAULT_SETTINGS.network, ...(r.network ?? {}) },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(r.appearance ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(r.notifications ?? {}) },
  };
}

interface SettingsCtx {
  settings: AppSettings;
  update: (mut: (s: AppSettings) => AppSettings) => Promise<void>;
  loaded: boolean;
}

const Ctx = createContext<SettingsCtx>({
  settings: DEFAULT_SETTINGS,
  update: async () => void 0,
  loaded: false,
});

export function useSettings() {
  return useContext(Ctx);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await invoke<unknown>("load_settings");
        setSettings(mergeWithDefaults(raw));
      } catch (e) {
        console.warn("load_settings failed:", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const update = useCallback(async (mut: (s: AppSettings) => AppSettings) => {
    let next: AppSettings | undefined;
    setSettings((curr) => {
      next = mut(curr);
      return next;
    });
    if (!next) return;
    try {
      await invoke("save_settings", { settings: next });
    } catch (e) {
      console.error("save_settings failed:", e);
    }
  }, []);

  return <Ctx.Provider value={{ settings, update, loaded }}>{children}</Ctx.Provider>;
}
