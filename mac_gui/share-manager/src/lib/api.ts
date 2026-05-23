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

  // --- system / permissions ---
  openPrivacySettings: (pane?: string) =>
    invoke<void>("open_privacy_settings", { pane }),
  hasFullDiskAccess: () => invoke<boolean>("has_full_disk_access"),

  // --- T2 shared clipboard (Windows §13 v2 mirror) ---
  readSharedClipboard: () => invoke<unknown>("read_shared_clipboard"),
  writeSharedClipboard: (content: string) =>
    invoke<unknown>("write_shared_clipboard", { content }),
  listClipboardHistory: (limit?: number) =>
    invoke<unknown[]>("list_clipboard_history", { limit }),
  listCompressedImages: () =>
    invoke<{ ref: string; size_bytes: number; ts: string }[]>("list_compressed_images"),
  compressedImagePath: (imageRef: string) =>
    invoke<string>("compressed_image_path", { imageRef }),

  // --- T3 auto-verify pending transfers ---
  autoVerifyPending: () => invoke<number>("auto_verify_pending"),

  // --- T7 worklog journal ---
  appendWorklog: (date: string, body: string) =>
    invoke<void>("append_worklog", { date, body }),

  // --- T4 Log Hub (jsonl streams under <share>/00_System/80_Logs) ---
  listLogEntries: (category: LogCategoryId, limit?: number) =>
    invoke<LogEntry[]>("list_log_entries", { category, limit }),
  /** Distinct from appendWorklog (Markdown daily file) — this writes one
   * jsonl row that the LogsView renders. */
  appendLogWorklog: (summary: string, detail?: string) =>
    invoke<void>("append_log_worklog", { summary, detail }),

  // --- T6 HTML asset inspector (send pre-flight) ---
  inspectHtmlAssets: (path: string) =>
    invoke<HtmlInspect>("inspect_html_assets", { path }),

  // --- T1.2 git dashboard (real bodies; signatures match brief §18.2) ---
  git: {
    scanRepos: () => invoke<string[]>("scan_git_repos"),
    scanAndPublish: () => invoke<number>("scan_and_publish_git"),
    publishStatus: (repoPath: string) =>
      invoke<void>("publish_git_status", { repoPath }),
    listStatus: () => invoke<HostGitSnapshot[]>("list_git_status"),
    listLogs: () => invoke<Record<string, GitLogDoc>>("list_git_logs"),
    /** Hits api.github.com for the given owner/repo list with the stored
     * PAT, returns the live results and updates remote-cache.json. */
    fetchRemote: (ownerRepos: string[]) =>
      invoke<RemoteRepoState[]>("github_fetch_remote", { ownerRepos }),
    readRemoteCache: () => invoke<RemoteCacheDoc>("read_remote_cache"),
    /** Build the per-repo merged graph (§18.4 schema). */
    buildRepoGraph: (ownerRepo: string) =>
      invoke<RepoGraph>("build_repo_graph", { ownerRepo }),
    fileDiff: (repoPath: string, filePath: string, rev?: string) =>
      invoke<string>("git_file_diff", { repoPath, filePath, rev }),
    configRead: (repoPath: string) =>
      invoke<string>("git_config_read", { repoPath }),
    listBranches: (repoPath: string) =>
      invoke<string[]>("git_list_branches", { repoPath }),
    /** Single shared PAT — no host param per brief §18.3. */
    setToken: (token: string) =>
      invoke<void>("git_set_token", { token }),
    hasToken: () =>
      invoke<{ has_token: boolean }>("git_has_token"),
    clearToken: () => invoke<void>("git_clear_token"),
    testToken: () => invoke<TokenInfo>("git_test_token"),
    sshStatus: () => invoke<GitSshStatus>("git_ssh_status"),
    generateSshKey: () => invoke<GitSshStatus>("git_generate_ssh_key"),
  },

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

/** Category IDs that have a JSONL stream under 80_Logs. The 5th sidebar
 * item ("compressed") is rendered from `listCompressedImages` instead. */
export type LogCategoryId = "send" | "recv" | "error" | "worklog";

/** One JSONL row from the log stream. Fields are loose because each
 * category emits a different shape; LogsView branches on `event` /
 * `summary`. `ts`/`host`/`os` are always present (injected by the
 * backend appender). */
export interface LogEntry {
  ts: string;
  host: string;
  os: string;
  /** send/recv/error rows */
  event?: string;
  /** worklog rows */
  summary?: string;
  detail?: string;
  /** common */
  transfer_id?: string;
  category?: string;
  checked?: number;
  mismatches?: number;
  missing?: number;
  error?: string;
  stderr?: string;
  direction?: string;
  [extra: string]: unknown;
}

/** HTML inspector pre-flight result — mirror of commands.rs::HtmlInspect. */
export interface HtmlAsset {
  reference: string;
  kind: "css" | "script" | "img" | "other";
  exists: boolean;
}
export interface HtmlInspect {
  is_html: boolean;
  has_inline_style: boolean;
  parent_dir: string;
  assets: HtmlAsset[];
}

// ─── Git dashboard DTOs (mirror src-tauri/src/git.rs) ──────────────

export interface GitCommitInfo {
  sha: string;
  msg: string;
  date: string;
}

export interface RepoStatus {
  owner_repo: string | null;
  path: string;
  branch: string;
  head: string;
  upstream: string | null;
  dirty: number;
  dirty_files: string[];
  unpushed: number;
  ahead: number;
  behind: number;
  stash: number;
  last_commit: GitCommitInfo | null;
  remote_url: string | null;
}

export interface HostGitSnapshot {
  schema_version: number;
  host: string;
  os: "macos" | "windows" | "linux" | string;
  scanned_at: string;
  repos: RepoStatus[];
}

export interface CommitNode {
  sha: string;
  parents: string[];
  msg: string;
  author: string;
  date: string;
}

/** One host's git-log.json contents (the `{logs: {ownerRepo: {branch: [..]}}}` doc). */
export interface GitLogDoc {
  schema_version: number;
  host: string;
  os: string;
  scanned_at: string;
  logs: Record<string, Record<string, CommitNode[]>>;
}

export interface RemoteBranch {
  name: string;
  sha: string;
}
export interface RemotePr {
  number: number;
  title: string;
  head: string;
  base: string;
}
export interface RemoteRepoState {
  owner_repo: string;
  default_branch: string;
  default_sha: string;
  branches: RemoteBranch[];
  open_prs: RemotePr[];
  fetched_at: string;
  error: string | null;
}
export interface RemoteCacheDoc {
  fetched_at?: string;
  repos: RemoteRepoState[];
}

export interface TokenInfo {
  login: string;
  name: string | null;
  orgs: string[];
}

export interface GitSshStatus {
  has_key: boolean;
  public_key: string | null;
  path: string | null;
}

/** RepoGraph node — one commit in the merged per-branch view (§18.4). */
export interface RepoGraphCommit {
  sha: string;
  short: string;
  parents: string[];
  msg: string;
  author: string;
  date: string;
  /** source-key → whether this commit appears in that source's history */
  in: Record<string, boolean>;
  /** source-keys whose HEAD points at this commit */
  tips: string[];
  /** is this the latest common ancestor across all sources */
  ancestor: boolean;
}

export interface RepoGraphPerHostSummary {
  ahead: number;
  behind: number;
  has_remote: boolean;
}

export interface RepoGraphBranch {
  commits: RepoGraphCommit[];
  /** source-key → tip SHA */
  pointers: Record<string, string>;
  common_ancestor: string | null;
  /** host → ahead/behind vs remote */
  summary: Record<string, RepoGraphPerHostSummary>;
}

export interface RepoGraph {
  owner_repo: string;
  default_branch: string;
  branches: string[];
  hosts: { host: string; os: string }[];
  has_token: boolean;
  per_branch: Record<string, RepoGraphBranch>;
}
