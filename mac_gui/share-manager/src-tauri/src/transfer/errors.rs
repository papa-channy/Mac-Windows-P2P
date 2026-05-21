// errors.rs — port of TransferError.swift. Exit-code mapping per §5.3.

use std::fmt;

#[derive(Debug)]
pub enum TransferError {
    /// exit 11
    RawSecretBlocked { filename: String, rule: String, pattern: String },
    /// exit 20
    Io { msg: String, underlying: Option<std::io::Error> },
    /// exit 64
    Usage(String),
    /// exit 20
    ShareNotMounted { expected_path: String },
    /// signal (exit 0) — caller needs to confirm overwrite
    DestinationExists { path: String },
}

impl TransferError {
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::RawSecretBlocked { .. } => 11,
            Self::Io { .. } => 20,
            Self::ShareNotMounted { .. } => 20,
            Self::DestinationExists { .. } => 0,
            Self::Usage(_) => 64,
        }
    }
}

impl fmt::Display for TransferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RawSecretBlocked { filename, rule, pattern } =>
                write!(f, "BLOCKED by RAW_SECRET rule ({rule}, matched: {pattern}): {filename}"),
            Self::Io { msg, underlying: Some(e) } => write!(f, "I/O error: {msg} — {e}"),
            Self::Io { msg, underlying: None } => write!(f, "I/O error: {msg}"),
            Self::Usage(m) => write!(f, "Usage error: {m}"),
            Self::ShareNotMounted { expected_path } =>
                write!(f, "Share not mounted (expected at {expected_path})"),
            Self::DestinationExists { path } =>
                write!(f, "Destination exists: {path} — overwrite confirmation required"),
        }
    }
}

impl std::error::Error for TransferError {}

impl From<std::io::Error> for TransferError {
    fn from(e: std::io::Error) -> Self {
        Self::Io { msg: e.to_string(), underlying: Some(e) }
    }
}

impl TransferError {
    pub fn io<S: Into<String>>(msg: S, e: std::io::Error) -> Self {
        Self::Io { msg: msg.into(), underlying: Some(e) }
    }
    pub fn io_msg<S: Into<String>>(msg: S) -> Self {
        Self::Io { msg: msg.into(), underlying: None }
    }
}
