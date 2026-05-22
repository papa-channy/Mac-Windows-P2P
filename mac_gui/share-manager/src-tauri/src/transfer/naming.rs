// naming.rs — port of Naming.swift. §4.3 filename rule:
//
//   <YYYY-MM-DD>__<category-key>__<basename>__v<NN><ext>
//
// - category_key is the english lower-case key (not the Korean label)
// - basename is the original stem (any Unicode), NFC-normalized
// - directories have no ext (empty string)
// - version is v01..v99 (zero-padded)

use chrono::{DateTime, Local};
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

use super::timestamps;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Components {
    pub date: String,
    pub category_key: String,
    pub basename: String,
    pub version: u32,
    pub ext: String,
}

/// (basename, ext) split. ext = "" for directories and dotfiles without a
/// secondary extension; otherwise ".ext" (leading dot included).
pub fn split(name: &str, is_directory: bool) -> (String, String) {
    let nfc: String = name.nfc().collect();
    if is_directory {
        return (nfc, String::new());
    }
    // Skip leading-dot files: dotfiles without a secondary dot keep ext = "".
    if let Some(idx) = nfc.rfind('.') {
        if idx > 0 {
            let (b, e) = nfc.split_at(idx);
            return (b.to_string(), e.to_string());
        }
    }
    (nfc, String::new())
}

pub fn render_components(c: &Components) -> String {
    format!(
        "{date}__{key}__{base}__v{ver:02}{ext}",
        date = c.date,
        key  = c.category_key,
        base = c.basename,
        ver  = c.version,
        ext  = c.ext,
    )
}

pub fn render(
    date: DateTime<Local>,
    category_key: &str,
    original: &Path,
    is_directory: bool,
    version: u32,
) -> String {
    let name = original
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let (basename, ext) = split(name, is_directory);
    render_components(&Components {
        date: timestamps::filename_date(date),
        category_key: category_key.to_string(),
        basename,
        version,
        ext,
    })
}

/// Reverse-parse a rendered filename. Returns None if shape doesn't match.
/// Basenames may contain "__", so we tokenize from the tail.
pub fn parse(filename: &str) -> Option<Components> {
    let nfc: String = filename.nfc().collect();

    let (stem, ext) = if let Some(idx) = nfc.rfind('.') {
        if idx > 0 {
            (nfc[..idx].to_string(), nfc[idx..].to_string())
        } else {
            (nfc.clone(), String::new())
        }
    } else {
        (nfc.clone(), String::new())
    };

    // tail: "__v<NN>"
    let tail_len = "__v00".len();
    if stem.len() < tail_len { return None; }
    let (head, tail) = stem.split_at(stem.len() - tail_len);
    if !tail.starts_with("__v") { return None; }
    let ver_str = &tail[3..];
    if ver_str.len() != 2 || !ver_str.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let version: u32 = ver_str.parse().ok()?;

    let parts: Vec<&str> = head.splitn(3, "__").collect();
    if parts.len() < 3 { return None; }
    let (date, category_key, basename) = (parts[0], parts[1], parts[2]);

    // shape check: YYYY-MM-DD
    if date.len() != 10
        || !date.chars().enumerate().all(|(i, c)| match i {
            4 | 7 => c == '-',
            _ => c.is_ascii_digit(),
        })
    {
        return None;
    }
    if category_key.is_empty() || basename.is_empty() { return None; }

    Some(Components {
        date: date.to_string(),
        category_key: category_key.to_string(),
        basename: basename.to_string(),
        version,
        ext,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_canonical_filename() {
        let c = Components {
            date: "2026-05-18".to_string(),
            category_key: "documents".to_string(),
            basename: "예상 공수 산정 근거".to_string(),
            version: 1,
            ext: ".html".to_string(),
        };
        assert_eq!(render_components(&c), "2026-05-18__documents__예상 공수 산정 근거__v01.html");
    }

    #[test]
    fn parse_round_trip() {
        let s = "2026-05-18__documents__my__report__v07.html";
        let c = parse(s).expect("parse");
        assert_eq!(c.date, "2026-05-18");
        assert_eq!(c.category_key, "documents");
        assert_eq!(c.basename, "my__report");
        assert_eq!(c.version, 7);
        assert_eq!(c.ext, ".html");
    }

    #[test]
    fn folder_has_no_ext() {
        let (b, e) = split("my-folder", true);
        assert_eq!(b, "my-folder");
        assert_eq!(e, "");
    }

    #[test]
    fn dotfile_has_no_ext() {
        let (b, e) = split(".gitignore", false);
        assert_eq!(b, ".gitignore");
        assert_eq!(e, "");
    }
}
