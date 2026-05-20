use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    MacToWindows,
    WindowsToMac,
}

impl Direction {
    pub fn from_cli(s: &str) -> Option<Self> {
        match s {
            "mac-to-windows" | "mac_to_windows" => Some(Self::MacToWindows),
            "windows-to-mac" | "windows_to_mac" => Some(Self::WindowsToMac),
            _ => None,
        }
    }

    pub fn folder_name(&self) -> &'static str {
        match self {
            Self::MacToWindows => "10_Mac_to_Windows",
            Self::WindowsToMac => "20_Windows_to_Mac",
        }
    }

    pub fn manifest_token(&self) -> &'static str {
        match self {
            Self::MacToWindows => "mac_to_windows",
            Self::WindowsToMac => "windows_to_mac",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Repos,
    Data,
    Documents,
    Research,
    Env,
    Builds,
    Assets,
    Misc,
}

impl Category {
    pub fn folder_name(&self) -> &'static str {
        match self {
            Self::Repos => "10_Repos",
            Self::Data => "20_Data",
            Self::Documents => "30_Documents",
            Self::Research => "40_Research",
            Self::Env => "50_Env",
            Self::Builds => "60_Builds",
            Self::Assets => "70_Assets",
            Self::Misc => "90_Misc",
        }
    }

    pub fn from_cli(s: &str) -> Option<Self> {
        match s {
            "repos" => Some(Self::Repos),
            "data" => Some(Self::Data),
            "documents" => Some(Self::Documents),
            "research" => Some(Self::Research),
            "env" => Some(Self::Env),
            "builds" => Some(Self::Builds),
            "assets" => Some(Self::Assets),
            "misc" => Some(Self::Misc),
            _ => None,
        }
    }
}

/// Per SPEC §1.4
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ExitCode {
    Ok = 0,
    ValidationWarning = 10,
    ValidationBlock = 11,
    IoError = 20,
    ChecksumMismatch = 30,
    ConfigError = 40,
    UsageError = 64,
}
