use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: u32,
    pub tool: String,
    pub tool_version: String,
    pub transfer_id: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub direction: String,
    pub category: String,
    pub batch_name: String,
    pub version: u32,
    pub source: Source,
    pub destination: Destination,
    pub mode: String,
    pub compression: Option<Compression>,
    pub files: Vec<FileEntry>,
    pub totals: Totals,
    pub rules_fired: Vec<RuleFired>,
    pub warnings: Vec<RuleFired>,
    pub blocks: Vec<RuleFired>,
    pub checksum_file: String,
    pub log_file: String,
    pub state: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Source {
    pub host: String,
    pub user: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Destination {
    pub share_path: String,
    pub primary_file: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Compression {
    pub algo: String,
    pub level: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub mtime: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Totals {
    pub files_scanned: u64,
    pub files_included: u64,
    pub files_excluded: u64,
    pub files_blocked: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RuleFired {
    pub rule: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
}
