use crate::checksum::{sha256, sidecar};
use crate::types::ExitCode;
use std::path::Path;

pub fn run(file: &Path, against: &Path, json: bool) -> ExitCode {
    let entries = match sidecar::read(against) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("verify: cannot read sidecar {}: {}", against.display(), e);
            return ExitCode::IoError;
        }
    };

    let basename = match file.file_name().and_then(|s| s.to_str()) {
        Some(n) => n.to_string(),
        None => {
            eprintln!("verify: cannot extract basename from {}", file.display());
            return ExitCode::UsageError;
        }
    };

    let expected = match entries.iter().find(|e| e.filename == basename) {
        Some(e) => e.hash.clone(),
        None if entries.len() == 1 => entries[0].hash.clone(),
        None => {
            eprintln!(
                "verify: no entry in {} matches filename '{}'",
                against.display(),
                basename
            );
            return ExitCode::UsageError;
        }
    };

    let actual = match sha256::hash_file(file) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("verify: cannot hash {}: {}", file.display(), e);
            return ExitCode::IoError;
        }
    };

    let matched = actual == expected;

    if json {
        let payload = serde_json::json!({
            "file": file.display().to_string(),
            "expected": expected,
            "actual": actual,
            "match": matched,
        });
        println!("{}", payload);
    } else if matched {
        println!("OK   {}", file.display());
    } else {
        println!(
            "FAIL {} (expected {}, got {})",
            file.display(),
            expected,
            actual
        );
    }

    if matched {
        ExitCode::Ok
    } else {
        ExitCode::ChecksumMismatch
    }
}
