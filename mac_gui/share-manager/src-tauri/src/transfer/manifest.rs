// manifest.rs — port of Manifest.swift. §4.5 v1 manifest schema (phase-1 shim).
//
// serde_json keeps the key order from the struct definition; sorted-keys
// output is achieved by routing through a BTreeMap during serialization.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::share::Direction;
use super::timestamps;
use chrono::{DateTime, Local};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Source {
    pub host: String,
    pub user: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Destination {
    pub share_path: String,
    pub primary_file: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub mtime: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Totals {
    pub files_included: u32,
    pub bytes_out: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub schema_version: u32,
    pub tool: String,
    pub tool_version: String,

    pub transfer_id: String,
    pub created_at: String,

    pub direction: String,
    pub category: String,
    pub batch_name: String,
    pub version: u32,

    pub source: Source,
    pub destination: Destination,
    pub mode: String,
    pub files: Vec<FileEntry>,
    pub totals: Totals,
    pub state: String,
}

pub const TOOL_NAME: &str = "send-to-windows.rust (phase-1 shim)";
pub const TOOL_VERSION: &str = "0.1.0";

pub fn make_transfer_id(
    date: DateTime<Local>,
    direction: Direction,
    category_key: &str,
    batch_name: &str,
    version: u32,
) -> String {
    let ts = timestamps::transfer_id_timestamp(date);
    format!(
        "{ts}__{src}__{tgt}__{cat}__{batch}__v{ver:02}",
        src = direction.source(),
        tgt = direction.target(),
        cat = category_key,
        batch = batch_name,
        ver = version,
    )
}

/// Serialize with sorted keys + pretty-print, matching Swift's
/// `[.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]`.
pub fn encode_json(m: &Manifest) -> Result<Vec<u8>, serde_json::Error> {
    // Round-trip through serde_json::Value, then re-encode using a BTreeMap
    // tree so every level emits sorted keys deterministically.
    let v = serde_json::to_value(m)?;
    let sorted = sort_value(v);
    serde_json::to_vec_pretty(&sorted)
}

fn sort_value(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(map) => {
            let mut out: BTreeMap<String, serde_json::Value> = BTreeMap::new();
            for (k, val) in map {
                out.insert(k, sort_value(val));
            }
            serde_json::Value::Object(out.into_iter().collect())
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(sort_value).collect())
        }
        other => other,
    }
}

pub fn decode(data: &[u8]) -> Result<Manifest, serde_json::Error> {
    serde_json::from_slice(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn transfer_id_shape() {
        let d = Local.with_ymd_and_hms(2026, 5, 18, 15, 20, 55).unwrap();
        let id = make_transfer_id(d, Direction::MacToWindows, "documents", "report", 1);
        assert!(id.contains("__mac__windows__documents__report__v01"));
        assert!(id.starts_with("2026-05-18T152055"));
    }

    #[test]
    fn encode_emits_sorted_keys() {
        let m = Manifest {
            schema_version: 1,
            tool: TOOL_NAME.into(),
            tool_version: TOOL_VERSION.into(),
            transfer_id: "x".into(),
            created_at: "y".into(),
            direction: "mac_to_windows".into(),
            category: "documents".into(),
            batch_name: "z".into(),
            version: 1,
            source: Source { host: "h".into(), user: "u".into(), path: "p".into() },
            destination: Destination { share_path: "s".into(), primary_file: "f".into() },
            mode: "file".into(),
            files: vec![],
            totals: Totals { files_included: 0, bytes_out: 0 },
            state: "ready".into(),
        };
        let bytes = encode_json(&m).unwrap();
        let s = std::str::from_utf8(&bytes).unwrap();
        let batch_pos = s.find("batch_name").unwrap();
        let cat_pos   = s.find("category").unwrap();
        assert!(batch_pos < cat_pos, "batch_name must appear before category");
    }
}
