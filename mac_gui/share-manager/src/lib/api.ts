// Thin wrapper over `@tauri-apps/api/core.invoke` so React components don't
// scatter `invoke("cmd_name", { ... })` strings everywhere. Every backend
// command is mirrored here with its TypeScript shape — when commands.rs
// changes, update this file too.
import { invoke } from "@tauri-apps/api/core";

export type Direction = "mac_to_windows" | "windows_to_mac";
export type StateKey =
  | "dropzone"
  | "staged"
  | "ready"
  | "received"
  | "rejected";

export interface TransferItem {
  direction: string;
  state: string;
  category_key: string;
  category_label: string;
  category_emoji: string;
  category_folder: string;
  path: string;
  name: string;
  size_bytes: number;
  modified_iso: string;
  is_dir: boolean;
  /** None when no matching manifest exists (orphan file). */
  transfer_id: string | null;
}

export interface FsNode {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes: number;
  children: FsNode[];
  truncated: boolean;
  child_overflow: number;
}

export interface NoteEntry {
  schema_version: number;
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  updated_by: { host: string; os: string };
}

export interface ClipboardEntryBase {
  ts: string;
  host: string;
  os: string;
  content: string;
  len: number;
}
export interface ClipboardTextEntry extends ClipboardEntryBase {
  kind: "text";
}
export interface ClipboardImageEntry extends ClipboardEntryBase {
  kind: "image";
  image_ref: string;
  width: number;
  height: number;
  size_bytes: number;
}
export type ClipboardEntry = ClipboardTextEntry | ClipboardImageEntry;

export interface FileVerifyResult {
  path: string;
  expected: string;
  actual: string;
  ok: boolean;
  error: string | null;
}
export interface VerifyResult {
  transfer_id: string;
  direction: string;
  mode: string;
  ok: boolean;
  checked: number;
  mismatches: number;
  missing: number;
  files: FileVerifyResult[];
}

export const api = {
  // --- share / transfers ---
  shareRoot: () => invoke<string>("share_root"),
  listTransfers: (direction: Direction, state: StateKey) =>
    invoke<TransferItem[]>("list_transfers", { direction, state }),
  readManifest: (transferId: string) =>
    invoke<unknown>("read_manifest", { transferId }),
  sendPath: (sourcePath: string, category: string) =>
    invoke<string>("send_path", { sourcePath, category }),

  // --- filesystem helpers ---
  openPath: (path: string) => invoke<void>("open_path", { path }),
  revealInExplorer: (path: string) =>
    invoke<void>("reveal_in_explorer", { path }),
  listDirectory: (path: string, maxDepth: number) =>
    invoke<FsNode>("list_directory", { path, maxDepth }),
  parentDirectory: (path: string) =>
    invoke<string>("parent_directory", { path }),
  homeDirectory: () => invoke<string>("home_directory"),
  desktopDirectory: () => invoke<string>("desktop_directory"),
  pickFolder: () => invoke<string | null>("pick_folder"),

  // --- settings / policy ---
  loadSettings: () => invoke<unknown>("load_settings"),
  saveSettings: (settings: unknown) =>
    invoke<void>("save_settings", { settings }),
  loadPolicy: () => invoke<unknown>("load_policy"),
  savePolicy: (policy: unknown) => invoke<void>("save_policy", { policy }),
  publishProfile: () => invoke<string>("publish_profile"),
  listProfiles: () => invoke<unknown[]>("list_profiles"),
  detectProjectLanguage: (path: string) =>
    invoke<unknown>("detect_project_language", { path }),
  listLanguagePresets: () => invoke<unknown[]>("list_language_presets"),

  // --- notes ---
  listNotes: () => invoke<NoteEntry[]>("list_notes"),
  getNote: (id: string) => invoke<NoteEntry>("get_note", { id }),
  saveNote: (id: string | null, title: string, body: string) =>
    invoke<NoteEntry>("save_note", { id, title, body }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),

  // --- clipboard ---
  listClipboardEntries: (limit?: number) =>
    invoke<ClipboardEntry[]>("list_clipboard_entries", { limit }),
  copyToOsClipboard: (text: string) =>
    invoke<void>("copy_to_os_clipboard", { text }),
  clearOwnClipboardHistory: () => invoke<void>("clear_own_clipboard_history"),
  /** Absolute path to a stored clipboard image — feed through convertFileSrc. */
  clipboardImagePath: (imageRef: string) =>
    invoke<string>("clipboard_image_path", { imageRef }),
  copyImageToOsClipboard: (imageRef: string) =>
    invoke<void>("copy_image_to_os_clipboard", { imageRef }),

  // --- transfer integrity verification ---
  verifyTransfer: (transferId: string) =>
    invoke<VerifyResult>("verify_transfer", { transferId }),

  // --- icon theme install (folder or git URL) ---
  installIconTheme: (folder: string) =>
    invoke<{ id: string; name: string; root_path: string; theme_json_path: string; icon_count: number }>(
      "install_icon_theme",
      { folder },
    ),
  installIconThemeFromGit: (repoUrl: string) =>
    invoke<{ id: string; name: string; root_path: string; theme_json_path: string; icon_count: number }>(
      "install_icon_theme_from_git",
      { repoUrl },
    ),
  installIconThemeFromVsix: (url: string, slug?: string) =>
    invoke<{ id: string; name: string; root_path: string; theme_json_path: string; icon_count: number }>(
      "install_icon_theme_from_vsix",
      { url, slug },
    ),

  // --- connectivity ---
  checkConnection: (host: string, port?: number) =>
    invoke<unknown>("check_connection", { host, port }),
  speedTestLocal: (bytes?: number) =>
    invoke<unknown>("speed_test_local", { bytes }),

  // --- desktop alias ---
  installDesktopAlias: () => invoke<void>("install_desktop_alias"),
  removeDesktopAlias: () => invoke<void>("remove_desktop_alias"),
  desktopAliasStatus: () =>
    invoke<{ status: "healthy" | "misdirected" | "blocked_by_file" | "absent"; target?: string }>(
      "desktop_alias_status",
    ),

  // --- release notes ---
  getReleaseNotes: () => invoke<ReleaseEntry[]>("get_release_notes"),
  currentAppVersion: () => invoke<string>("current_app_version"),
};

export interface ReleaseEntry {
  version: string;
  date: string;
  title: string;
  highlights: string[];
  notes: string;
}
