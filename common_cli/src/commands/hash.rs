use crate::checksum::sha256;
use crate::types::ExitCode;
use std::path::Path;

pub fn run(path: &Path, json: bool) -> ExitCode {
    match sha256::hash_file(path) {
        Ok(h) => {
            if json {
                let payload = serde_json::json!({
                    "path": path.display().to_string(),
                    "sha256": h,
                });
                println!("{}", payload);
            } else {
                println!("{}  {}", h, path.display());
            }
            ExitCode::Ok
        }
        Err(e) => {
            eprintln!("hash: {}: {}", path.display(), e);
            ExitCode::IoError
        }
    }
}
