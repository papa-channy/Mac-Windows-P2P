use super::rules::FileRule;
use super::{Finding, Severity};
use std::path::Path;

/// SPEC §3.1 RAW_SECRET — filename pattern matching only.
/// Content-pattern detection (high-entropy KEY=value) is left for Phase 2+.
pub struct RawSecret;

impl FileRule for RawSecret {
    fn check(&self, path: &Path) -> Vec<Finding> {
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => return vec![],
        };
        let lower = name.to_ascii_lowercase();
        let matched: Option<&'static str> = if lower == ".env" {
            Some(".env exact match")
        } else if lower.starts_with(".env.") && !is_template_env(&lower) {
            Some(".env.* (not template)")
        } else if lower.ends_with(".pem") {
            Some("*.pem")
        } else if lower.ends_with(".key") {
            Some("*.key")
        } else if lower.ends_with(".p12") {
            Some("*.p12")
        } else if lower.ends_with(".mobileprovision") {
            Some("*.mobileprovision")
        } else if lower.starts_with("service-account") && lower.ends_with(".json") {
            Some("service-account*.json")
        } else {
            None
        };
        matched
            .map(|why| {
                vec![Finding {
                    severity: Severity::Block,
                    rule: "RAW_SECRET",
                    path: path.display().to_string(),
                    evidence: format!("filename matched {}", why),
                }]
            })
            .unwrap_or_default()
    }
}

fn is_template_env(lower: &str) -> bool {
    matches!(
        lower,
        ".env.example" | ".env.template" | ".env.sample" | ".env.encrypted"
    )
}

/// SPEC §3.1 INVALID_WIN_FILENAME
pub struct InvalidWinFilename;

impl FileRule for InvalidWinFilename {
    fn check(&self, path: &Path) -> Vec<Finding> {
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => return vec![],
        };
        let bad_chars: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
        if let Some(ch) = name.chars().find(|c| bad_chars.contains(c)) {
            return vec![Finding {
                severity: Severity::Block,
                rule: "INVALID_WIN_FILENAME",
                path: path.display().to_string(),
                evidence: format!("contains invalid character {:?}", ch),
            }];
        }
        if name.ends_with(' ') || name.ends_with('.') {
            return vec![Finding {
                severity: Severity::Block,
                rule: "INVALID_WIN_FILENAME",
                path: path.display().to_string(),
                evidence: "name ends with trailing space or dot".into(),
            }];
        }
        let stem_upper = name
            .split('.')
            .next()
            .unwrap_or("")
            .to_ascii_uppercase();
        const RESERVED: &[&str] = &[
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];
        if RESERVED.contains(&stem_upper.as_str()) {
            return vec![Finding {
                severity: Severity::Block,
                rule: "INVALID_WIN_FILENAME",
                path: path.display().to_string(),
                evidence: format!("reserved Windows name: {}", stem_upper),
            }];
        }
        vec![]
    }
}

/// SPEC §3.1 LONG_PATH
pub struct LongPath;

impl FileRule for LongPath {
    fn check(&self, path: &Path) -> Vec<Finding> {
        let full = path.display().to_string();
        let full_len = full.chars().count();
        if full_len > 240 {
            return vec![Finding {
                severity: Severity::Block,
                rule: "LONG_PATH",
                path: full,
                evidence: format!("full path length {} > 240", full_len),
            }];
        }
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            let name_len = name.chars().count();
            if name_len > 255 {
                return vec![Finding {
                    severity: Severity::Block,
                    rule: "LONG_PATH",
                    path: full,
                    evidence: format!("filename length {} > 255", name_len),
                }];
            }
        }
        vec![]
    }
}
