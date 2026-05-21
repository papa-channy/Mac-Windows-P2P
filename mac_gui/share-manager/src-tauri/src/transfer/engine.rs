// engine.rs — port of Engine.swift. Orchestrates one-shot file/folder send:
//
//   1. RAW_SECRET check (filename + recursive for directories)
//   2. Apply naming rule → final destination name
//   3. Compute destination path (share / direction / category)
//   4. Overwrite check — if exists and overwrite=false, signal DestinationExists
//   5. Copy atomically (".incoming__<uuid>" temp → rename)
//   6. SHA-256 (file or dir-hash)
//   7. Manifest / sidecar / log emitted to share-side directories
//   8. Append to local sent.jsonl
//
// Batch mode (Phase 3) follows further down — multiple items into a single
// transfer_id, all into one category.

use chrono::{DateTime, Local};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::share::{category_by_key, share_root, Category, Direction};

use super::{
    checksum, errors::TransferError, hashing, log as tlog, manifest, naming, raw_secret,
    sent_history::{self, SentHistoryEntry},
    timestamps,
};

pub struct TransferRequest {
    pub source: PathBuf,
    pub category: &'static Category,
    pub direction: Direction,
    pub share_root: PathBuf,
    pub source_host: String,
    pub source_user: String,
    pub batch_name: Option<String>,
    pub version: u32,
    pub overwrite_if_exists: bool,
    pub now: DateTime<Local>,
}

pub struct TransferOutcome {
    pub transfer_id: String,
    pub destination: PathBuf,
    pub sha256: String,
    pub bytes: u64,
    pub mode: &'static str,
    pub manifest_path: PathBuf,
    pub sidecar_path: PathBuf,
    pub log_path: PathBuf,
}

pub fn send(req: &TransferRequest) -> Result<TransferOutcome, TransferError> {
    if !req.share_root.exists() {
        return Err(TransferError::ShareNotMounted {
            expected_path: req.share_root.display().to_string(),
        });
    }
    let src_meta = fs::metadata(&req.source).map_err(|e| {
        TransferError::io(format!("source not found: {}", req.source.display()), e)
    })?;
    let is_dir = src_meta.is_dir();
    let mode: &'static str = if is_dir { "directory" } else { "file" };

    // (1) RAW_SECRET — top name and (for dirs) every regular file under it.
    let top_name = req
        .source
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    if let Some(m) = raw_secret::check(&top_name) {
        return Err(TransferError::RawSecretBlocked {
            filename: top_name,
            rule: m.rule,
            pattern: m.pattern,
        });
    }
    if is_dir {
        for entry in WalkDir::new(&req.source).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() { continue; }
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(m) = raw_secret::check(&name) {
                return Err(TransferError::RawSecretBlocked {
                    filename: name,
                    rule: m.rule,
                    pattern: m.pattern,
                });
            }
        }
    }

    // (2) Naming
    let final_name = naming::render(req.now, req.category.key, &req.source, is_dir, req.version);

    // (3) Destination
    let dest_dir = req.share_root
        .join("10_Exchange")
        .join(req.direction.folder())
        .join("20_Ready")
        .join(req.category.folder);
    let dest = dest_dir.join(&final_name);

    // (4) Overwrite check
    if dest.exists() {
        if !req.overwrite_if_exists {
            return Err(TransferError::DestinationExists {
                path: dest.display().to_string(),
            });
        }
        remove_existing(&dest)?;
    }

    // (5) Copy atomically
    fs::create_dir_all(&dest_dir).map_err(|e| {
        TransferError::io(format!("mkdir: {}", dest_dir.display()), e)
    })?;
    let tmp_name = format!(".incoming__{}", Uuid::new_v4());
    let tmp = dest_dir.join(&tmp_name);
    if let Err(e) = copy_path(&req.source, &tmp) {
        let _ = fs::remove_dir_all(&tmp);
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_dir_all(&tmp);
        let _ = fs::remove_file(&tmp);
        return Err(TransferError::io(format!("rename → {}", dest.display()), e));
    }

    // (6) SHA-256
    let (sha, total_bytes): (String, u64) = if is_dir {
        let d = hashing::dir_hash(&dest)?;
        (d.combined, d.total_bytes)
    } else {
        let meta = fs::metadata(&dest).map_err(TransferError::from)?;
        (hashing::sha256_file(&dest)?, meta.len())
    };

    // (7) Manifest + sidecar + log
    let batch_name = req.batch_name.clone().unwrap_or_else(|| {
        let (b, _) = naming::split(
            &req.source.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            is_dir,
        );
        b
    });
    let transfer_id = manifest::make_transfer_id(
        req.now, req.direction, req.category.key, &batch_name, req.version,
    );
    let mtime = timestamps::iso8601(req.now);
    let share_path = format!(
        "{}/20_Ready/{}/",
        req.direction.exchange_folder(),
        req.category.folder,
    );

    let manifest_struct = manifest::Manifest {
        schema_version: 1,
        tool: manifest::TOOL_NAME.into(),
        tool_version: manifest::TOOL_VERSION.into(),
        transfer_id: transfer_id.clone(),
        created_at: timestamps::iso8601(req.now),
        direction: req.direction.token().into(),
        category: req.category.key.into(),
        batch_name: batch_name.clone(),
        version: req.version,
        source: manifest::Source {
            host: req.source_host.clone(),
            user: req.source_user.clone(),
            path: req.source.display().to_string(),
        },
        destination: manifest::Destination {
            share_path: share_path.clone(),
            primary_file: final_name.clone(),
        },
        mode: mode.into(),
        files: vec![manifest::FileEntry {
            path: final_name.clone(),
            size_bytes: total_bytes,
            sha256: sha.clone(),
            mtime,
        }],
        totals: manifest::Totals {
            files_included: 1,
            bytes_out: total_bytes,
        },
        state: "ready".into(),
    };

    let manifest_path = req.share_root
        .join("00_System")
        .join("30_Manifests")
        .join(req.direction.token())
        .join(format!("{transfer_id}.json"));
    let manifest_bytes = manifest::encode_json(&manifest_struct)
        .map_err(|e| TransferError::io_msg(format!("manifest encode: {e}")))?;
    atomic_write(&manifest_path, &manifest_bytes)?;

    let sidecar_text = if is_dir {
        let digest = hashing::dir_hash(&dest)?; // recomputed for the entries list
        checksum::render_directory(&final_name, &digest)
    } else {
        checksum::render_file(&sha, &final_name)
    };
    let sidecar_path = req.share_root
        .join("00_System")
        .join("50_Checksums")
        .join(req.direction.token())
        .join(format!("{transfer_id}.sha256"));
    atomic_write(&sidecar_path, sidecar_text.as_bytes())?;

    let log_text = tlog::render(
        &transfer_id, mode,
        &req.source.display().to_string(),
        &dest.display().to_string(),
        &sha, total_bytes, req.now, "context-menu send",
    );
    let log_path = req.share_root
        .join("00_System")
        .join("40_Logs")
        .join(req.direction.token())
        .join(format!("{transfer_id}.log"));
    atomic_write(&log_path, log_text.as_bytes())?;

    // (8) Local sent.jsonl — best-effort, send still succeeds if append fails.
    let _ = sent_history::append(&SentHistoryEntry {
        transfer_id: transfer_id.clone(),
        created_at: timestamps::iso8601(req.now),
        direction: req.direction.token().into(),
        mode: mode.into(),
        category: req.category.key.into(),
        primary_name: final_name.clone(),
        item_count: 1,
        bytes: total_bytes,
        sha256: Some(sha.clone()),
        dest_share_path: share_path,
        source_path: req.source.display().to_string(),
    });

    Ok(TransferOutcome {
        transfer_id,
        destination: dest,
        sha256: sha,
        bytes: total_bytes,
        mode,
        manifest_path,
        sidecar_path,
        log_path,
    })
}

/// Resolve a category key, defaulting to "documents" when missing.
pub fn resolve_category(key: &str) -> Result<&'static Category, TransferError> {
    category_by_key(key).ok_or_else(|| TransferError::Usage(format!("unknown category: {key}")))
}

/// Construct a request using the current machine's hostname/user and "now".
pub fn build_request(
    source: PathBuf,
    category_key: &str,
    direction: Direction,
    version: u32,
    overwrite_if_exists: bool,
) -> Result<TransferRequest, TransferError> {
    Ok(TransferRequest {
        source,
        category: resolve_category(category_key)?,
        direction,
        share_root: share_root(),
        source_host: hostname_or("Mac"),
        source_user: std::env::var("USER").unwrap_or_else(|_| "user".into()),
        batch_name: None,
        version,
        overwrite_if_exists,
        now: Local::now(),
    })
}

fn hostname_or(fallback: &str) -> String {
    if let Ok(out) = std::process::Command::new("scutil").args(["--get", "LocalHostName"]).output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() { return s; }
        }
    }
    std::env::var("HOSTNAME").unwrap_or_else(|_| fallback.into())
}

fn copy_path(src: &Path, dst: &Path) -> Result<(), TransferError> {
    let meta = fs::metadata(src).map_err(TransferError::from)?;
    if meta.is_dir() {
        copy_dir_recursive(src, dst)
    } else {
        fs::copy(src, dst)
            .map(|_| ())
            .map_err(|e| TransferError::io(format!("copy → {}", dst.display()), e))
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), TransferError> {
    fs::create_dir_all(dst).map_err(|e| TransferError::io(format!("mkdir: {}", dst.display()), e))?;
    for entry in WalkDir::new(src).min_depth(1).into_iter() {
        let entry = entry.map_err(|e| TransferError::io_msg(format!("walk: {e}")))?;
        let rel = entry
            .path()
            .strip_prefix(src)
            .map_err(|_| TransferError::io_msg("strip_prefix"))?;
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| {
                TransferError::io(format!("mkdir: {}", target.display()), e)
            })?;
        } else if entry.file_type().is_file() {
            if let Some(p) = target.parent() {
                fs::create_dir_all(p).ok();
            }
            fs::copy(entry.path(), &target).map_err(|e| {
                TransferError::io(format!("copy → {}", target.display()), e)
            })?;
        }
        // symlinks are skipped (phase-1 does not preserve them — matches Swift's
        // FileManager.copyItem default of resolving symlinks for regular files).
    }
    Ok(())
}

fn remove_existing(p: &Path) -> Result<(), TransferError> {
    let meta = fs::metadata(p).map_err(|e| {
        TransferError::io(format!("stat existing: {}", p.display()), e)
    })?;
    if meta.is_dir() {
        fs::remove_dir_all(p)
            .map_err(|e| TransferError::io(format!("rm -rf existing: {}", p.display()), e))
    } else {
        fs::remove_file(p)
            .map_err(|e| TransferError::io(format!("rm existing: {}", p.display()), e))
    }
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), TransferError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| TransferError::io(format!("mkdir: {}", parent.display()), e))?;
    }
    let tmp = path.with_extension(format!(
        "{}__tmp__{}",
        path.extension().and_then(|s| s.to_str()).unwrap_or(""),
        Uuid::new_v4(),
    ));
    fs::write(&tmp, data)
        .map_err(|e| TransferError::io(format!("write: {}", tmp.display()), e))?;
    fs::rename(&tmp, path)
        .map_err(|e| TransferError::io(format!("rename → {}", path.display()), e))?;
    Ok(())
}
