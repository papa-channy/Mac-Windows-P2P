use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "shareguard", version, about = "Mac<->Windows transfer engine")]
pub struct Cli {
    #[arg(long, global = true)]
    pub profile: Option<String>,

    #[arg(long, global = true)]
    pub config: Option<PathBuf>,

    #[arg(long, short = 'q', global = true)]
    pub quiet: bool,

    #[arg(long, global = true)]
    pub json: bool,

    #[arg(long, global = true)]
    pub dry_run: bool,

    #[arg(long, global = true)]
    pub force: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Validate a path against share rules (read-only)
    Check {
        path: PathBuf,
    },

    /// Stage a transfer to the share's 20_Ready/
    Send {
        path: PathBuf,
        #[arg(long)]
        direction: String,
        #[arg(long)]
        category: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long, default_value = "file")]
        mode: String,
        #[arg(long)]
        no_stage: bool,
    },

    /// Pull from 20_Ready/ and verify
    Receive {
        #[arg(long)]
        direction: String,
        #[arg(long)]
        batch: Option<String>,
        #[arg(long)]
        into: Option<PathBuf>,
    },

    /// Move received items to 90_Archive/
    Archive {
        transfer_id: String,
    },

    /// List pending items per state folder
    Status {
        #[arg(long)]
        direction: Option<String>,
        #[arg(long)]
        category: Option<String>,
    },

    /// Show structured log entries
    Log {
        #[arg(long = "transfer-id")]
        transfer_id: Option<String>,
        #[arg(long)]
        tail: Option<usize>,
    },

    /// Config inspection
    #[command(subcommand)]
    Config(ConfigCmd),

    /// Environment checks
    Doctor,

    /// Dry-run plan (JSON)
    Plan {
        path: PathBuf,
        #[arg(long)]
        direction: String,
    },

    /// Compute and print SHA-256
    Hash {
        path: PathBuf,
    },

    /// Verify a file against a .sha256 sidecar
    Verify {
        file: PathBuf,
        #[arg(long)]
        against: PathBuf,
    },

    /// Move a transfer to 80_Quarantine/
    Quarantine {
        transfer_id: String,
        #[arg(long)]
        reason: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum ConfigCmd {
    /// Print effective configuration
    Show,
}
