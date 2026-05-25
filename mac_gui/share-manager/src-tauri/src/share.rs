// share.rs — share-root constants and the Direction / State / Category
// enums. Mirrors windows_gui/share-manager/src-tauri/src/share.rs so a
// manifest written on either side parses identically on the other.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Mac side default mount point. Override with $MW_SHARE_ROOT.
pub const DEFAULT_SHARE_ROOT: &str = "/Volumes/Mac-Window_Share";

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
    pub fn source(&self) -> &'static str {
        match self {
            Self::MacToWindows => "mac",
            Self::WindowsToMac => "windows",
        }
    }
    pub fn target(&self) -> &'static str {
        match self {
            Self::MacToWindows => "windows",
            Self::WindowsToMac => "mac",
        }
    }
    pub fn exchange_folder(&self) -> String {
        format!("10_Exchange/{}", self.folder())
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

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Category {
    pub key: &'static str,
    pub label: &'static str,
    pub emoji: &'static str,
    pub folder: &'static str,
}

// Canonical category list. Keep in lockstep with WINDOWS_PARITY_BRIEF §4.1
// and windows_gui/share-manager/src-tauri/src/share.rs.
//
// Note: the Swift sample used `unsorted` (sort-) for the catch-all; Windows
// settled on `unclassified` (class-). Going with `unclassified` here so
// manifests/sidecars round-trip with the Windows side.
pub const CATEGORIES: &[Category] = &[
    Category { key: "documents",    label: "Documents",    emoji: "📄", folder: "30_Documents"    },
    Category { key: "data",         label: "Data",         emoji: "📊", folder: "20_Data"         },
    Category { key: "repos",        label: "Code",         emoji: "💻", folder: "10_Repos"        },
    Category { key: "research",     label: "Research",     emoji: "🔬", folder: "40_Research"     },
    Category { key: "env",          label: "Env",          emoji: "⚙",  folder: "50_Env"          },
    Category { key: "builds",       label: "Builds",       emoji: "🛠", folder: "60_Builds"       },
    Category { key: "assets",       label: "Assets",       emoji: "🎨", folder: "70_Assets"       },
    Category { key: "misc",         label: "Misc",         emoji: "📦", folder: "90_Misc"         },
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

pub fn checksums_dir(direction: Direction) -> PathBuf {
    share_root()
        .join("00_System")
        .join("50_Checksums")
        .join(direction.token())
}

pub fn logs_dir(direction: Direction) -> PathBuf {
    share_root()
        .join("00_System")
        .join("40_Logs")
        .join(direction.token())
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
    pub icon_theme: String,
    #[serde(default)]
    pub icon_themes: Vec<IconTheme>,
    #[serde(default)]
    pub icon_theme_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct NotificationSettings {
    /// Master toggle. When false, nothing fires regardless of channel
    /// flags below.
    #[serde(default)]
    pub enabled: bool,
    /// macOS native banner via tauri-plugin-notification.
    #[serde(default = "default_true")]
    pub native: bool,
    /// Slack-compatible webhook ({"text": "..."} POST). Same format
    /// works for Discord and most Slack-clones — paste the incoming
    /// webhook URL.
    #[serde(default)]
    pub webhook_url: String,
    /// Per-event-type filter. Defaults: send + verify, off for the rest.
    #[serde(default = "default_true")]
    pub on_send_ok: bool,
    #[serde(default = "default_true")]
    pub on_send_fail: bool,
    #[serde(default = "default_true")]
    pub on_verify_fail: bool,
    #[serde(default)]
    pub on_verify_ok: bool,
    #[serde(default)]
    pub on_clipboard: bool,
}

fn default_true() -> bool { true }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Settings {
    pub schema_version: u32,
    pub tree: TreeSettings,
    pub network: NetworkSettings,
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub notifications: NotificationSettings,
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
                // Mac side: the Windows host. Override per-machine via settings.
                remote_host: "192.168.50.1".to_string(),
            },
            appearance: AppearanceSettings {
                icon_theme: "default".to_string(),
                icon_themes: Vec::new(),
                icon_theme_path: None,
            },
            notifications: NotificationSettings {
                enabled: false,
                native: true,
                webhook_url: String::new(),
                on_send_ok: true,
                on_send_fail: true,
                on_verify_fail: true,
                on_verify_ok: false,
                on_clipboard: false,
            },
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
