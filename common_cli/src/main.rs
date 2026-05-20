// Phase-1 skeleton: most modules below are scaffolding for SPEC §12 phases 2-6.
// Suppress dead-code warnings until those phases land.
#![allow(dead_code)]

use clap::Parser;
use std::process::ExitCode;

mod archive;
mod checksum;
mod cli;
mod commands;
mod errors;
mod ignore;
mod manifest;
mod types;
mod validation;

fn main() -> ExitCode {
    let args = cli::Cli::parse();
    ExitCode::from(commands::dispatch(args) as u8)
}
