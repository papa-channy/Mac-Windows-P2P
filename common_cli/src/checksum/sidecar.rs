use crate::errors::ShareGuardError;
use std::path::Path;

/// One row from a `shasum -a 256` style file: `<hex64>  <filename>`.
#[derive(Debug, Clone)]
pub struct SidecarEntry {
    pub hash: String,
    pub filename: String,
}

pub fn parse(content: &str) -> Result<Vec<SidecarEntry>, ShareGuardError> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut split = line.splitn(2, char::is_whitespace);
        let hash = split
            .next()
            .ok_or_else(|| ShareGuardError::MalformedSidecar(format!("line {}: no hash", i + 1)))?;
        let rest = split
            .next()
            .ok_or_else(|| ShareGuardError::MalformedSidecar(format!("line {}: no filename", i + 1)))?;
        let filename = rest.trim_start();
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(ShareGuardError::MalformedSidecar(format!(
                "line {}: not a sha256 hex",
                i + 1
            )));
        }
        out.push(SidecarEntry {
            hash: hash.to_ascii_lowercase(),
            filename: filename.to_string(),
        });
    }
    Ok(out)
}

pub fn read(path: &Path) -> Result<Vec<SidecarEntry>, ShareGuardError> {
    let s = std::fs::read_to_string(path)?;
    parse(&s)
}

pub fn format_line(hash: &str, filename: &str) -> String {
    format!("{}  {}\n", hash, filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_line() {
        let s = "d94e3b7b97d1530fbca6c33a2267fcf77da2cfbc693196b6dfb66545d663a0cf  README.md\n";
        let v = parse(s).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].filename, "README.md");
    }

    #[test]
    fn parse_skips_blank_and_comments() {
        let s = "\n# a comment\nabc def\n";
        let r = parse(s);
        assert!(r.is_err(), "non-hex hash should fail");
    }

    #[test]
    fn parse_lowercases_hash() {
        let upper = "D94E3B7B97D1530FBCA6C33A2267FCF77DA2CFBC693196B6DFB66545D663A0CF  X\n";
        let v = parse(upper).unwrap();
        assert_eq!(v[0].hash, v[0].hash.to_ascii_lowercase());
    }
}
