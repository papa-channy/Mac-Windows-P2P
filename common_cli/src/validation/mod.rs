pub mod filename;
pub mod rules;

use crate::types::ExitCode;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    AutoExclude,
    Warning,
    Block,
}

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub severity: Severity,
    pub rule: &'static str,
    pub path: String,
    pub evidence: String,
}

#[derive(Debug, Default, Serialize)]
pub struct CheckReport {
    pub blocks: Vec<Finding>,
    pub warnings: Vec<Finding>,
    pub auto_excludes: Vec<Finding>,
    pub files_scanned: usize,
}

impl CheckReport {
    pub fn exit_code(&self) -> ExitCode {
        if !self.blocks.is_empty() {
            ExitCode::ValidationBlock
        } else if !self.warnings.is_empty() {
            ExitCode::ValidationWarning
        } else {
            ExitCode::Ok
        }
    }
}
