use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const DEFAULT_SHARE_ROOT: &str = r"D:\Mac-Window_Share";

pub fn share_root() -> PathBuf {
    PathBuf::from(std::env::var("MW_SHARE_ROOT").unwrap_or_else(|_| DEFAULT_SHARE_ROOT.into()))
}

#[allow(dead_code)]
pub fn share_root_str() -> String {
    share_root().to_string_lossy().into_owned()
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    MacToWindows,
    WindowsToMac,
}

impl Direction {
    pub fn folder(&self) -> &'static str {
        match self {
            Self::MacToWindows => "10_Mac_to_Windows",
            Self::WindowsToMac => "20_Windows_to_Mac",
        }
    }
    pub fn token(&self) -> &'static str {
        match self {
            Self::MacToWindows => "mac_to_windows",
            Self::WindowsToMac => "windows_to_mac",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "mac_to_windows" | "mac-to-windows" => Some(Self::MacToWindows),
            "windows_to_mac" | "windows-to-mac" => Some(Self::WindowsToMac),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Dropzone,
    Staged,
    Ready,
    Received,
    Rejected,
}

impl State {
    pub fn folder(&self) -> &'static str {
        match self {
            Self::Dropzone => "00_Dropzone",
            Self::Staged   => "10_Staged",
            Self::Ready    => "20_Ready",
            Self::Received => "90_Received",
            Self::Rejected => "80_Rejected",
        }
    }
    pub fn all() -> [State; 5] {
        [State::Dropzone, State::Staged, State::Ready, State::Received, State::Rejected]
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "dropzone" => Some(State::Dropzone),
            "staged"   => Some(State::Staged),
            "ready"    => Some(State::Ready),
            "received" => Some(State::Received),
            "rejected" => Some(State::Rejected),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Category {
    pub key: &'static str,
    pub label: &'static str,
    pub emoji: &'static str,
    pub folder: &'static str,
}

pub const CATEGORIES: &[Category] = &[
    Category { key: "documents",    label: "Documents",   emoji: "📄", folder: "30_Documents"    },
    Category { key: "data",         label: "Data",        emoji: "📊", folder: "20_Data"         },
    Category { key: "repos",        label: "Code",        emoji: "💻", folder: "10_Repos"        },
    Category { key: "research",     label: "Research",    emoji: "🔬", folder: "40_Research"     },
    Category { key: "env",          label: "Env",         emoji: "⚙",  folder: "50_Env"          },
    Category { key: "builds",       label: "Builds",      emoji: "🛠", folder: "60_Builds"       },
    Category { key: "assets",       label: "Assets",      emoji: "🎨", folder: "70_Assets"       },
    Category { key: "misc",         label: "Misc",        emoji: "📦", folder: "90_Misc"         },
    Category { key: "unclassified", label: "Unclassified", emoji: "❔", folder: "99_Unclassified" },
];

pub fn category_by_folder(folder: &str) -> Option<&'static Category> {
    CATEGORIES.iter().find(|c| c.folder == folder)
}

pub fn category_by_key(key: &str) -> Option<&'static Category> {
    CATEGORIES.iter().find(|c| c.key == key)
}

pub fn state_dir(direction: Direction, state: State) -> PathBuf {
    share_root()
        .join("10_Exchange")
        .join(direction.folder())
        .join(state.folder())
}

pub fn category_dir(direction: Direction, state: State, cat_folder: &str) -> PathBuf {
    state_dir(direction, state).join(cat_folder)
}

pub fn manifests_dir(direction: Direction) -> PathBuf {
    share_root()
        .join("00_System")
        .join("30_Manifests")
        .join(direction.token())
}

pub fn extract_transfer_id_from_name(name: &str) -> Option<String> {
    let _ = name;
    None
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FsNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub children: Vec<FsNode>,
    pub truncated: bool,
    pub child_overflow: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShortcutEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TreeSettings {
    pub max_depth: u32,
    pub shortcuts: Vec<ShortcutEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NetworkSettings {
    pub remote_host: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct IconTheme {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub theme_json_path: String,
    pub icon_count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppearanceSettings {
    pub icon_theme: String,             // "default" | "ascii" | <IconTheme.id>
    #[serde(default)]
    pub icon_themes: Vec<IconTheme>,
    #[serde(default)]
    pub icon_theme_path: Option<String>, // legacy single-path field, kept for back-compat
}

fn default_true() -> bool { true }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IntegritySettings {
    #[serde(default = "default_true")]
    pub auto_verify_on_receive: bool,
    #[serde(default = "default_true")]
    pub show_manual_button: bool,
}

impl Default for IntegritySettings {
    fn default() -> Self {
        Self { auto_verify_on_receive: true, show_manual_button: true }
    }
}

fn default_exclude_dirs() -> Vec<String> {
    ["Windows", "Program Files", "Program Files (x86)", "ProgramData",
     "$Recycle.Bin", "node_modules", "AppData", "Application Data",
     "System Volume Information", "Temp", ".cargo", ".rustup", "target"]
        .iter().map(|s| s.to_string()).collect()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitSettings {
    /// Extra directories to also scan (beyond a full drive walk).
    #[serde(default)]
    pub extra_roots: Vec<String>,
    /// Directory names pruned during the walk (perf + noise).
    #[serde(default = "default_exclude_dirs")]
    pub exclude_dirs: Vec<String>,
    /// Whether a non-credentialed full-disk scan is enabled.
    #[serde(default = "default_true")]
    pub scan_enabled: bool,
    /// GitHub owners you control (login + orgs), cached from PAT validation.
    /// NOT a secret — used only to filter the dashboard to your own repos.
    #[serde(default)]
    pub owners: Vec<String>,
    /// Show only repos whose owner is in `owners`.
    #[serde(default = "default_true")]
    pub only_mine: bool,
}

impl Default for GitSettings {
    fn default() -> Self {
        Self {
            extra_roots: Vec::new(),
            exclude_dirs: default_exclude_dirs(),
            scan_enabled: true,
            owners: Vec::new(),
            only_mine: true,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Settings {
    pub schema_version: u32,
    pub tree: TreeSettings,
    pub network: NetworkSettings,
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub integrity: IntegritySettings,
    #[serde(default)]
    pub git: GitSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            tree: TreeSettings {
                max_depth: 4,
                shortcuts: Vec::new(),
            },
            network: NetworkSettings {
                remote_host: "192.168.50.2".to_string(),
            },
            appearance: AppearanceSettings {
                icon_theme: "default".to_string(),
                icon_themes: Vec::new(),
                icon_theme_path: None,
            },
            integrity: IntegritySettings::default(),
            git: GitSettings::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectionStatus {
    pub host: String,
    pub port: u16,
    pub tcp_reachable: bool,
    pub tcp_latency_ms: u64,
    pub ping_reachable: bool,
    pub ping_latency_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SpeedResult {
    pub bytes: u64,
    pub write_ms: u64,
    pub read_ms: u64,
    pub write_mb_per_sec: f64,
    pub read_mb_per_sec: f64,
}
