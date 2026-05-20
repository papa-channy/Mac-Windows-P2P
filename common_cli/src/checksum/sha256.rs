use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

const READ_BUFFER: usize = 64 * 1024;
const READER_BUFFER: usize = 4 * 1024 * 1024;

pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(READER_BUFFER, file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; READ_BUFFER];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}
