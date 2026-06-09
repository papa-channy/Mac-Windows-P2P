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

#[derive(Debug)]
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

#[cfg(test)]
mod tests {
    //! Engine integration tests. Each test builds its own TempDir-backed
    //! TransferRequest and asserts on the on-disk artifacts. No env
    //! variables touched, so tests run in parallel safely.

    use super::*;
    use crate::share::{category_by_key, Direction};
    use sha2::Digest;
    use std::io::Write as _;
    use tempfile::TempDir;

    fn make_request(share: &TempDir, source: PathBuf, cat_key: &str, overwrite: bool) -> TransferRequest {
        TransferRequest {
            source,
            category: category_by_key(cat_key).expect("known category"),
            direction: Direction::MacToWindows,
            share_root: share.path().to_path_buf(),
            source_host: "test-host".into(),
            source_user: "tester".into(),
            batch_name: None,
            version: 1,
            overwrite_if_exists: overwrite,
            now: Local::now(),
        }
    }

    fn write_file(path: &Path, content: &[u8]) {
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(content).unwrap();
    }

    #[test]
    fn file_mode_produces_all_artifacts() {
        let share = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let source = src_dir.path().join("note.txt");
        write_file(&source, b"hello world");

        let req = make_request(&share, source.clone(), "documents", false);
        let out = send(&req).expect("send file");

        // (a) destination file present with original bytes
        assert!(out.destination.exists());
        assert_eq!(std::fs::read(&out.destination).unwrap(), b"hello world");
        assert!(out.destination
            .file_name().unwrap().to_string_lossy()
            .ends_with("__documents__note__v01.txt"));

        // (b) manifest parses correctly
        let manifest_raw = std::fs::read(&out.manifest_path).unwrap();
        let parsed = manifest::decode(&manifest_raw).expect("manifest decode");
        assert_eq!(parsed.schema_version, 1);
        assert_eq!(parsed.mode, "file");
        assert_eq!(parsed.direction, "mac_to_windows");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].sha256, hashing::sha256_file(&out.destination).unwrap());
        assert_eq!(parsed.totals.bytes_out, 11);

        // (c) sidecar matches `<sha>  <name>\n` exactly
        let sidecar = std::fs::read_to_string(&out.sidecar_path).unwrap();
        let expected = format!("{}  {}\n", out.sha256, out.destination.file_name().unwrap().to_string_lossy());
        assert_eq!(sidecar, expected);

        // (d) log: three lines, first contains "context-menu send:"
        let log = std::fs::read_to_string(&out.log_path).unwrap();
        let lines: Vec<&str> = log.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("context-menu send:"));
        assert!(lines[2].contains(&format!("transfer_id={}", out.transfer_id)));
    }

    #[test]
    fn directory_mode_walks_and_dir_hashes() {
        let share = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let folder = src_dir.path().join("myrepo");
        std::fs::create_dir_all(folder.join("sub")).unwrap();
        write_file(&folder.join("a.txt"), b"AAA");
        write_file(&folder.join("sub/b.txt"), b"BBB");
        write_file(&folder.join("sub/c.txt"), b"CCC");

        let req = make_request(&share, folder, "repos", false);
        let out = send(&req).expect("send dir");

        assert!(out.destination.is_dir());
        assert_eq!(out.mode, "directory");

        // Recompute dir-hash and compare. NFC ordering must match.
        let digest = hashing::dir_hash(&out.destination).unwrap();
        assert_eq!(digest.combined, out.sha256);
        assert_eq!(digest.total_bytes, 9);

        // Sidecar should have one line per file + one combined-hash line
        let sidecar = std::fs::read_to_string(&out.sidecar_path).unwrap();
        let line_count = sidecar.lines().count();
        assert_eq!(line_count, 3 + 1);
        assert!(sidecar.contains("# combined dir-hash"));
        assert!(sidecar.contains(&out.sha256));
    }

    #[test]
    fn raw_secret_block_top_level() {
        let share = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let source = src_dir.path().join(".env");
        write_file(&source, b"SECRET=1");

        let req = make_request(&share, source, "documents", false);
        let err = send(&req).unwrap_err();
        match err {
            // rule is now a fixed label; the matched glob is in `pattern`.
            TransferError::RawSecretBlocked { pattern, .. } => {
                assert!(pattern.contains(".env"), "pattern was {pattern}");
            }
            other => panic!("expected RawSecretBlocked, got {other:?}"),
        }
    }

    #[test]
    fn raw_secret_block_inside_directory() {
        let share = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let folder = src_dir.path().join("creds-folder");
        std::fs::create_dir_all(&folder).unwrap();
        write_file(&folder.join("readme.md"), b"docs");
        write_file(&folder.join("service-account-prod.json"), b"{}");

        let req = make_request(&share, folder, "documents", false);
        let err = send(&req).unwrap_err();
        assert!(matches!(err, TransferError::RawSecretBlocked { .. }));
    }

    #[test]
    fn destination_exists_returns_signal_not_error() {
        let share = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let source = src_dir.path().join("twice.txt");
        write_file(&source, b"first");
        let req1 = make_request(&share, source.clone(), "documents", false);
        send(&req1).expect("first send");
        // Same source path on the same day → identical destination name.
        let req2 = make_request(&share, source.clone(), "documents", false);
        let err = send(&req2).unwrap_err();
        assert!(matches!(err, TransferError::DestinationExists { .. }));
        assert_eq!(err.exit_code(), 0, "DestinationExists is a signal, not a failure");
    }

    #[test]
    fn overwrite_if_exists_replaces() {
        let share = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let source = src_dir.path().join("update.txt");

        write_file(&source, b"v1 content");
        let req1 = make_request(&share, source.clone(), "documents", false);
        let out1 = send(&req1).expect("first send");
        assert_eq!(std::fs::read(&out1.destination).unwrap(), b"v1 content");

        // Modify source, resend with overwrite=true
        write_file(&source, b"v2 content");
        let req2 = make_request(&share, source.clone(), "documents", true);
        let out2 = send(&req2).expect("overwrite send");
        assert_eq!(out1.destination, out2.destination);
        assert_eq!(std::fs::read(&out2.destination).unwrap(), b"v2 content");
    }

    #[test]
    fn share_not_mounted_returns_typed_error() {
        let src_dir = tempfile::tempdir().unwrap();
        let source = src_dir.path().join("orphan.txt");
        write_file(&source, b"x");

        let req = TransferRequest {
            source,
            category: category_by_key("documents").unwrap(),
            direction: Direction::MacToWindows,
            share_root: PathBuf::from("/this/definitely/does/not/exist/anywhere"),
            source_host: "h".into(),
            source_user: "u".into(),
            batch_name: None,
            version: 1,
            overwrite_if_exists: false,
            now: Local::now(),
        };
        let err = send(&req).unwrap_err();
        assert!(matches!(err, TransferError::ShareNotMounted { .. }));
    }

    /// E2E send against the real share if mounted. Cleans up after itself.
    /// Skipped (returns OK) when /Volumes/Mac-Window_Share isn't present so
    /// CI / unmounted dev machines stay green.
    #[test]
    fn e2e_send_against_real_share_if_mounted() {
        let share = PathBuf::from("/Volumes/Mac-Window_Share");
        if !share.exists() {
            eprintln!("[e2e] share not mounted at {} — skipping", share.display());
            return;
        }

        let src_dir = tempfile::tempdir().unwrap();
        let source = src_dir.path().join(format!("e2e-{}.txt", Uuid::new_v4().simple()));
        let payload = format!("e2e smoke {}", Local::now().to_rfc3339());
        write_file(&source, payload.as_bytes());

        let req = TransferRequest {
            source: source.clone(),
            category: category_by_key("documents").unwrap(),
            direction: Direction::MacToWindows,
            share_root: share.clone(),
            source_host: "e2e-test".into(),
            source_user: "tester".into(),
            batch_name: None,
            version: 1,
            overwrite_if_exists: false,
            now: Local::now(),
        };
        let out = send(&req).expect("e2e send");

        // Hard assertions on share-side artifacts
        assert!(out.destination.exists(), "destination missing: {}", out.destination.display());
        assert!(out.manifest_path.exists(), "manifest missing: {}", out.manifest_path.display());
        assert!(out.sidecar_path.exists(), "sidecar missing: {}", out.sidecar_path.display());
        assert!(out.log_path.exists(), "log missing: {}", out.log_path.display());

        // Manifest must decode and match
        let m = manifest::decode(&std::fs::read(&out.manifest_path).unwrap()).unwrap();
        assert_eq!(m.transfer_id, out.transfer_id);
        assert_eq!(m.direction, "mac_to_windows");
        assert_eq!(m.files[0].sha256, out.sha256);

        // shasum -a 256 cross-check
        let recomputed = hashing::sha256_file(&out.destination).unwrap();
        assert_eq!(recomputed, out.sha256, "destination file hash drifted");

        // Sidecar exact format
        let sidecar = std::fs::read_to_string(&out.sidecar_path).unwrap();
        let expected_line = format!(
            "{}  {}\n",
            out.sha256,
            out.destination.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(sidecar, expected_line);

        // Log has 3 lines
        let log_lines = std::fs::read_to_string(&out.log_path).unwrap().lines().count();
        assert_eq!(log_lines, 3);

        eprintln!("[e2e] OK — transfer_id: {}", out.transfer_id);
        eprintln!("[e2e]   destination: {}", out.destination.display());
        eprintln!("[e2e]   manifest:    {}", out.manifest_path.display());

        // Cleanup so we don't pollute the share
        let _ = std::fs::remove_file(&out.destination);
        let _ = std::fs::remove_file(&out.manifest_path);
        let _ = std::fs::remove_file(&out.sidecar_path);
        let _ = std::fs::remove_file(&out.log_path);
    }

    #[test]
    fn manifest_combined_dir_hash_matches_hand_computed() {
        // Deterministic algorithm sanity: build a folder, hand-compute the
        // combined hash via the §4.4 spec, and assert the engine result
        // matches byte-for-byte.
        let share = tempfile::tempdir().unwrap();
        let src_dir = tempfile::tempdir().unwrap();
        let folder = src_dir.path().join("smol");
        std::fs::create_dir_all(&folder).unwrap();
        write_file(&folder.join("z.txt"), b"zzz");
        write_file(&folder.join("a.txt"), b"aaa");

        // engine answer
        let req = make_request(&share, folder.clone(), "data", false);
        let out = send(&req).expect("send");

        // hand-compute on the (sorted lex) order: a.txt, z.txt
        let sha_a = hex::encode(sha2::Sha256::digest(b"aaa"));
        let sha_z = hex::encode(sha2::Sha256::digest(b"zzz"));
        let mut buf = Vec::new();
        for (rel, sha) in [("a.txt", sha_a), ("z.txt", sha_z)] {
            buf.extend_from_slice(rel.as_bytes());
            buf.push(0);
            buf.extend_from_slice(sha.as_bytes());
            buf.push(0x0A);
        }
        let expected = hex::encode(sha2::Sha256::digest(&buf));
        assert_eq!(out.sha256, expected, "engine dir-hash diverged from §4.4 spec");
    }
}
