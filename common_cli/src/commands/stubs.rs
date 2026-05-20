use crate::types::ExitCode;

pub fn not_implemented(cmd: &'static str) -> ExitCode {
    eprintln!(
        "shareguard: '{}' is not implemented yet. See SHAREGUARD_SPEC.md \u{00a7}12 for the phase plan.",
        cmd
    );
    ExitCode::UsageError
}
