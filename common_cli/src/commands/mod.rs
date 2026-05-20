pub mod check;
pub mod hash;
pub mod stubs;
pub mod verify;

use crate::cli::{Cli, Command};
use crate::types::ExitCode;

pub fn dispatch(args: Cli) -> ExitCode {
    match args.command {
        Command::Check { path } => check::run(&path, args.json, args.force),
        Command::Hash { path } => hash::run(&path, args.json),
        Command::Verify { file, against } => verify::run(&file, &against, args.json),

        // Phase 2+ stubs
        Command::Send { .. } => stubs::not_implemented("send"),
        Command::Receive { .. } => stubs::not_implemented("receive"),
        Command::Archive { .. } => stubs::not_implemented("archive"),
        Command::Status { .. } => stubs::not_implemented("status"),
        Command::Log { .. } => stubs::not_implemented("log"),
        Command::Config(_) => stubs::not_implemented("config"),
        Command::Doctor => stubs::not_implemented("doctor"),
        Command::Plan { .. } => stubs::not_implemented("plan"),
        Command::Quarantine { .. } => stubs::not_implemented("quarantine"),
    }
}
