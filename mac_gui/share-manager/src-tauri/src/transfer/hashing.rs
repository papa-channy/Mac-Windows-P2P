// hashing.rs — port of Hashing.swift. §4.4 SHA-256 rules.
//
// File mode: SHA-256 of file bytes (streamed in 1 MiB chunks).
// Folder mode:
//   1. Enumerate regular files under root.
//   2. Forward-slash-normalize each relative path and NFC.
//   3. Sort entries lexicographically by relative path.
//   4. For each entry build "<rel>\0<sha>\n" bytes.
//   5. Concatenate and SHA-256 → combined dir-hash.

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;
use walkdir::WalkDir;

use super::errors::TransferError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    pub relative_path: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryDigest {
    pub combined: String,
    pub entries: Vec<FileEntry>,
    pub total_bytes: u64,
}

const CHUNK: usize = 1 << 20;

pub fn sha256_file(path: &Path) -> Result<String, TransferError> {
    let mut f = File::open(path)
        .map_err(|e| TransferError::io(format!("open for hashing: {}", path.display()), e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| TransferError::io(format!("read while hashing: {}", path.display()), e))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn dir_hash(folder: &Path) -> Result<DirectoryDigest, TransferError> {
    let base = folder
        .canonicalize()
        .unwrap_or_else(|_| folder.to_path_buf());

    let mut raw: Vec<(String, PathBuf, u64)> = Vec::new();

    for entry in WalkDir::new(&base).into_iter() {
        let entry = entry.map_err(|e| TransferError::io_msg(format!("enumerate: {e}")))?;
        if !entry.file_type().is_file() { continue; }
        // Skip hidden files at any depth (.DS_Store etc) — matches Swift's
        // `[.skipsHiddenFiles]` enumerator option.
        if entry
            .path()
            .components()
            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
        {
            continue;
        }
        let meta = entry
            .metadata()
            .map_err(|e| TransferError::io_msg(format!("metadata: {e}")))?;
        let rel = entry
            .path()
            .strip_prefix(&base)
            .map_err(|_| TransferError::io_msg(format!("relativize: {}", entry.path().display())))?;
        let mut rel_s = rel.to_string_lossy().replace('\\', "/");
        rel_s = rel_s.nfc().collect();
        raw.push((rel_s, entry.path().to_path_buf(), meta.len()));
    }

    raw.sort_by(|a, b| a.0.cmp(&b.0));

    let mut combined = Sha256::new();
    let mut entries = Vec::with_capacity(raw.len());
    let mut total_bytes: u64 = 0;

    for (rel, abs, sz) in raw {
        let file_sha = sha256_file(&abs)?;
        total_bytes += sz;
        // "<rel>\0<sha>\n"
        combined.update(rel.as_bytes());
        combined.update([0u8]);
        combined.update(file_sha.as_bytes());
        combined.update([0x0Au8]);
        entries.push(FileEntry {
            relative_path: rel,
            sha256: file_sha,
            size_bytes: sz,
        });
    }

    Ok(DirectoryDigest {
        combined: hex::encode(combined.finalize()),
        entries,
        total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn known_sha256_for_empty_file() {
        let tmp = std::env::temp_dir().join("share-manager-empty-test");
        File::create(&tmp).unwrap();
        let sha = sha256_file(&tmp).unwrap();
        assert_eq!(sha, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        std::fs::remove_file(tmp).ok();
    }

    #[test]
    fn known_sha256_for_hello() {
        let tmp = std::env::temp_dir().join("share-manager-hello-test");
        let mut f = File::create(&tmp).unwrap();
        f.write_all(b"hello").unwrap();
        let sha = sha256_file(&tmp).unwrap();
        assert_eq!(sha, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        std::fs::remove_file(tmp).ok();
    }
}
