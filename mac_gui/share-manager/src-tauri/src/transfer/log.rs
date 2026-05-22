// log.rs — port of Log.swift. §4.7 phase-1 shim plain-text log (3 lines).
//
//   [ts] context-menu send: <abs-src> -> <abs-dst>
//   [ts] mode=<file|directory|batch>  hash=<full-sha>  payload=<n> bytes
//   [ts] state=ready transfer_id=<transfer-id>

use chrono::{DateTime, Local};

use super::timestamps;

pub fn render(
    transfer_id: &str,
    mode: &str,
    source_abs: &str,
    dest_abs: &str,
    hash_hex: &str,
    payload_bytes: u64,
    at: DateTime<Local>,
    entry_kind: &str,
) -> String {
    let ts = format!("[{}]", timestamps::log_timestamp(at));
    format!(
        "{ts} {entry_kind}: {source_abs} -> {dest_abs}\n\
         {ts} mode={mode}  hash={hash_hex}  payload={payload_bytes} bytes\n\
         {ts} state=ready transfer_id={transfer_id}\n"
    )
}
