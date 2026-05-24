// Tauri-less invoke shim for Playwright. Installed via
// `page.addInitScript` before the React app loads, so
// `@tauri-apps/api/core::invoke()` reads our fixture values instead of
// IPC-ing into a real Tauri runtime.
//
// Each test can override per-command responses by passing `overrides`
// to `installMockTauri(page, overrides)`. Anything not overridden falls
// back to the default fixture which represents a quiet, offline state.

import { Page } from "@playwright/test";

export type InvokeMock = Record<string, unknown> | ((cmd: string, args: unknown) => unknown);

const DEFAULT_INVOKE: Record<string, unknown> = {
  share_root: "/Volumes/Mac-Window_Share",
  list_transfers: [],
  load_settings: { theme: "light", git: { only_mine: false, owners: [], extra_roots: [], exclude_dirs: [] } },
  load_policy: { secrets: {} },
  list_notes: [],
  list_clipboard_entries: [],
  list_compressed_images: [],
  list_log_entries: [],
  read_shared_clipboard: { content: "", kind: "text", created_at: null, from: null, empty: true },
  has_full_disk_access: true,
  mount_status: { mounted: true, target: "/Volumes/Mac-Window_Share" },
  current_app_version: "0.3.0",
  get_release_notes: [],
  desktop_alias_status: { status: "healthy", target: "/Applications/share-manager.app" },
  home_directory: "/Users/test",
  desktop_directory: "/Users/test/Desktop",
  // Git surface
  list_git_status: [],
  list_git_logs: {},
  read_remote_cache: { repos: [] },
  git_has_token: { has_token: false },
  git_ssh_status: { has_key: false, public_key: null, path: null },
  scan_git_repos: [],
  // T2 wrappers
  list_clipboard_history: [],
};

export async function installMockTauri(page: Page, overrides: InvokeMock = {}) {
  await page.addInitScript((args: { defaults: Record<string, unknown>; overrides: Record<string, unknown> }) => {
    const responses: Record<string, unknown> = { ...args.defaults, ...args.overrides };
    // Minimal Tauri 2 internals shape used by @tauri-apps/api/core
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, _params: unknown) => {
        if (cmd in responses) {
          const v = responses[cmd];
          if (typeof v === "function") return Promise.resolve((v as (cmd: string, args: unknown) => unknown)(cmd, _params));
          return Promise.resolve(v);
        }
        // Any unconfigured command resolves to null — most code paths
        // tolerate that and short-circuit gracefully.
        return Promise.resolve(null);
      },
      transformCallback: (cb: unknown) => cb,
      unregisterCallback: () => undefined,
      convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    };
    // Some code paths probe `window.__TAURI__.event.listen`. Stub it so
    // calls don't throw — tests that need real events install their own
    // override.
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      event: {
        listen: () => Promise.resolve(() => undefined),
        emit: () => Promise.resolve(),
      },
    };
    // Suppress first-launch modals (PermissionsOnboarding +
    // AnnouncementModal). These pop on top of the sidebar and intercept
    // every click; tests run faster without dismissing them each time.
    try {
      localStorage.setItem("share-manager.permissions_onboarded", "1");
      localStorage.setItem("share-manager.last_seen_version", "0.3.0");
    } catch {
      /* localStorage not available in some environments */
    }
  }, { defaults: DEFAULT_INVOKE, overrides: overrides as Record<string, unknown> });
}
