use thiserror::Error;

#[derive(Error, Debug)]
pub enum ShareGuardError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("hex decode error: {0}")]
    Hex(#[from] hex::FromHexError),

    #[error("checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },

    #[error("malformed sidecar: {0}")]
    MalformedSidecar(String),

    #[error("invalid direction: {0}")]
    InvalidDirection(String),

    #[error("invalid category: {0}")]
    InvalidCategory(String),

    #[error("not yet implemented: {0}")]
    NotImplemented(&'static str),
}
