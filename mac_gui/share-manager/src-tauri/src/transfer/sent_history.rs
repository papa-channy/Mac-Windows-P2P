// sent_history.rs — port of SentHistory.swift. Append-only JSONL at
// ~/Library/Logs/MacWindowShare/sent.jsonl. Used by the "Sent" view as the
// single source of truth (so deleting files from the share doesn't erase
// the user's send history).

use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SentHistoryEntry {
    pub transfer_id: String,
    pub created_at: String,
    pub direction: String,
    pub mode: String,
    pub category: String,
    pub primary_name: String,
    pub item_count: u32,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub dest_share_path: String,
    pub source_path: String,
}

pub fn path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join("Library")
        .join("Logs")
        .join("MacWindowShare")
        .join("sent.jsonl")
}

pub fn append(entry: &SentHistoryEntry) -> std::io::Result<()> {
    let p = path();
    if let Some(parent) = p.parent() {
        create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&p)?;
    let mut bytes = serde_json::to_vec(entry).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;
    bytes.push(b'\n');
    f.write_all(&bytes)?;
    Ok(())
}

pub fn read_all() -> std::io::Result<Vec<SentHistoryEntry>> {
    let p = path();
    if !p.exists() {
        return Ok(vec![]);
    }
    let f = std::fs::File::open(&p)?;
    let r = BufReader::new(f);
    let mut out = Vec::new();
    for line in r.lines() {
        let line = match line { Ok(l) => l, Err(_) => continue };
        if line.trim().is_empty() { continue; }
        if let Ok(e) = serde_json::from_str::<SentHistoryEntry>(&line) {
            out.push(e);
        }
    }
    Ok(out)
}
