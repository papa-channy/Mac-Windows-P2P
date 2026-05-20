use crate::types::ExitCode;
use crate::validation::filename::{InvalidWinFilename, LongPath, RawSecret};
use crate::validation::rules::FileRule;
use crate::validation::{CheckReport, Severity};
use std::path::Path;
use walkdir::WalkDir;

pub fn run(path: &Path, json: bool, _force: bool) -> ExitCode {
    if !path.exists() {
        eprintln!("check: path does not exist: {}", path.display());
        return ExitCode::UsageError;
    }

    let rules: Vec<Box<dyn FileRule>> = vec![
        Box::new(RawSecret),
        Box::new(InvalidWinFilename),
        Box::new(LongPath),
    ];

    let mut report = CheckReport::default();

    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        report.files_scanned += 1;
        for rule in &rules {
            for finding in rule.check(entry.path()) {
                match finding.severity {
                    Severity::Block => report.blocks.push(finding),
                    Severity::Warning => report.warnings.push(finding),
                    Severity::AutoExclude => report.auto_excludes.push(finding),
                }
            }
        }
    }

    let exit = report.exit_code();

    if json {
        match serde_json::to_string_pretty(&report) {
            Ok(s) => println!("{}", s),
            Err(e) => {
                eprintln!("check: json serialize error: {}", e);
                return ExitCode::IoError;
            }
        }
    } else {
        print_text_report(&report, path, exit);
    }

    exit
}

fn print_text_report(report: &CheckReport, path: &Path, exit: ExitCode) {
    println!(
        "check: scanned {} file(s) under {}",
        report.files_scanned,
        path.display()
    );
    println!("  blocks   : {}", report.blocks.len());
    println!("  warnings : {}", report.warnings.len());

    if !report.blocks.is_empty() {
        println!();
        println!("  BLOCKING FINDINGS:");
        for f in &report.blocks {
            println!("    [{}] {} -- {}", f.rule, f.path, f.evidence);
        }
    }
    if !report.warnings.is_empty() {
        println!();
        println!("  WARNINGS:");
        for f in &report.warnings {
            println!("    [{}] {} -- {}", f.rule, f.path, f.evidence);
        }
    }

    println!();
    match exit {
        ExitCode::Ok => println!("  result   : OK"),
        ExitCode::ValidationWarning => {
            println!("  result   : warnings only (override with --force)")
        }
        ExitCode::ValidationBlock => println!("  result   : BLOCKED"),
        _ => println!("  result   : (unexpected exit)"),
    }
}
