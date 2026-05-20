# ShareGuard — CLI Specification (draft v0.1)

**Status**: draft, not implemented.
**Scope**: the cross-platform transfer engine used by both Mac and Windows
GUI wrappers. Mac mount/keep-alive is already handled by `mw` (see
`mac_gui/mw`) and is *not* in scope here.

> This document is the contract that the implementation must satisfy.
> Anything that moves files in or out of the share should ultimately go
> through `shareguard`, so behavior (validation, naming, manifest,
> checksum, archive) stays consistent regardless of which OS or UI
> triggered the transfer.

---

## 0. Goals & non-goals

**Goals**
- Single binary / single script with identical behavior on macOS and Windows.
- Every transfer produces three signed artifacts: the file(s), a manifest, a checksum file.
- Reject classes of mistakes that cause incident reports later (raw secrets, name collisions, oversize trees, long paths).
- Auditable: every action writes a structured log entry.

**Non-goals**
- Real-time bidirectional sync. ShareGuard is batch-oriented, not Dropbox.
- Conflict resolution for concurrent edits. Two operators editing the same staged file is operator error.
- Encryption at rest. Use OS / disk encryption; ShareGuard transports cleartext over SMB on a LAN-only link.
- Mount management on Mac. That lives in `mw`.

---

## 1. Command surface

```
shareguard <command> [args] [options]
```

### 1.1 Core commands

| Command | Purpose |
|---------|---------|
| `shareguard check <path>` | Run validation against `<path>` (file or dir). No side effects. Exit 0 if all rules pass; non-zero with structured report otherwise. |
| `shareguard send <path> --direction {mac-to-windows\|windows-to-mac} --category <cat> [--title <t>] [--mode {file\|zip}] [--no-stage]` | Validate → stage → manifest+checksum → atomic move to `20_Ready/`. |
| `shareguard receive --direction <dir> [--batch <id>] [--into <local-path>]` | Pull from `20_Ready/`, verify checksum, copy locally, move source to `90_Received/`. |
| `shareguard archive <transfer-id>` | Move a received transfer's `90_Received/` files into `90_Archive/<YYYY>/<YYYY-MM>/<direction>/<category>/`. Updates `_index`. |
| `shareguard status [--direction <dir>] [--category <cat>]` | List pending items per state folder. |
| `shareguard log [--transfer-id <id>] [--tail N]` | Show structured log entries. |
| `shareguard config show [--profile <name>]` | Print effective config (resolved ignore-rules, paths, defaults). |
| `shareguard doctor` | Environment checks (share mounted? CLI on PATH? perms? clock skew?). |

### 1.2 Subcommands for tooling integrations

| Command | Purpose |
|---------|---------|
| `shareguard plan <path> --direction ...` | Dry-run: print the planned actions as JSON (used by GUI confirmation dialogs). |
| `shareguard hash <path>` | Compute and print SHA-256 only (for ad-hoc verification). |
| `shareguard verify <file> --against <sha256-file>` | Verify a single file against a `.sha256` sidecar. |

### 1.3 Global options

- `--profile <name>` — load `00_System/10_Config/profiles/<name>.toml`
- `--config <path>` — use a specific config file instead of share defaults
- `--quiet` / `-q` — suppress non-error output
- `--json` — emit machine-readable JSON for tool integration
- `--dry-run` — show what would happen, change nothing
- `--force` — bypass non-blocking warnings (never bypasses security blocks)

### 1.4 Exit codes

| Code | Meaning |
|------|---------|
| 0    | Success |
| 10   | Validation failed (warnings only, `--force` not used) |
| 11   | Validation failed (blocks: secrets, invalid names, etc.) |
| 20   | I/O error (disk full, permission denied, share unreachable) |
| 30   | Checksum mismatch on verify |
| 40   | Configuration error |
| 64   | Usage error (unknown subcommand, missing required flag) |

---

## 2. Transfer states & lifecycle

```
   send                         receive
  ─────►                       ◄───────
   sender side                  receiver side

   <local source>
        │
        │ shareguard send
        ▼
   00_Dropzone/<category>/    ← copy lands here first (atomic write)
        │
        │ validation
        ▼
   10_Staged/<category>/      ← validated, name-rewritten, sidecars built
        │
        │ atomic move
        ▼
   20_Ready/<category>/       ← receiver may consume
        │
        │ shareguard receive (verifies checksum)
        ▼
   90_Received/<category>/    ← receiver marks delivery
        │
        │ shareguard archive (after N days OR on demand)
        ▼
   90_Archive/<YYYY>/<YYYY-MM>/<direction>/<category>/

   80_Rejected/<category>/   ← any state can route here on failure
                                with a .reject.json sidecar
```

### 2.1 State invariants

- A file in `20_Ready/` MUST have a matching manifest in `30_Manifests/` and checksum in `50_Checksums/` (same batch ID).
- A file in `80_Rejected/` MUST have a `<filename>.reject.json` sidecar with reason + rule fired.
- A file in `90_Received/` MUST have been verified against its `.sha256`.
- Names are immutable once they enter `10_Staged/` — re-runs create new versions.

### 2.2 Atomicity

- Drop into a file's final location uses **write-to-tmp + rename within same filesystem**. SMB rename is atomic for the directory listing.
- Moves between states use **rename within same SMB share** when possible. Cross-volume falls back to copy + verify + delete.

---

## 3. Validation rules

### 3.1 Blocks (exit 11 — never overrideable)

| Rule | Trigger | Action |
|------|---------|--------|
| RAW_SECRET | Filename matches `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.mobileprovision`, `service-account*.json`, content of `.env`-shaped lines (`KEY=value` with high-entropy values) in non-template files | Move to `80_Rejected/`, log reason |
| INVALID_WIN_FILENAME | Contains any of `\ / : * ? " < > \|` or trailing dot/space; reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`LPT9`) | Reject |
| LONG_PATH | Any path component > 255 chars OR full path > 240 chars on Windows side | Reject |
| CASE_COLLISION | Two entries differ only in case (`Config.ts` vs `config.ts`) — NTFS is case-insensitive | Reject (zip option avoids this) |
| BROKEN_SYMLINK | Symlink target missing | Reject |

### 3.2 Warnings (exit 10 — overrideable with `--force`)

| Rule | Trigger | Action |
|------|---------|--------|
| LARGE_TREE | >10,000 files OR >50,000 dirs | Warn; suggest `--mode zip` |
| SMALL_FILE_HEAVY | >1,000 files where 90% are <16KB | Warn; suggest zip (SMB throughput drops with metadata overhead) |
| MEDIA_HEAVY | Total > 50 GB | Warn; confirm intent |
| LEGACY_BUILD_DIR | Path contains `dist/`, `build/`, `out/`, `target/`, `.next/` | Warn; usually unwanted |
| KOREAN_NFKD | Filename uses NFKD instead of NFC normalization | Warn; auto-normalize on stage |

### 3.3 Auto-exclude (no warning, just skip)

Driven by `.shareignore` files (see §4). Default skips:
`.DS_Store`, `.AppleDouble/`, `Thumbs.db`, `desktop.ini`, `.git/`,
`node_modules/`, `.next/`, `.nuxt/`, `dist/`, `build/`, `coverage/`,
`.cache/`, `.venv/`, `venv/`, `__pycache__/`, `.pytest_cache/`, `*.pyc`,
`.idea/`, `.vscode/`, `*.log`.

---

## 4. `.shareignore` precedence

Files use gitignore-style syntax. **Higher number = higher priority (later
loaded, can re-include with `!pattern`)**.

```
1. Global defaults
   00_System/10_Config/ignore_rules/default.shareignore

2. Direction-specific
   00_System/10_Config/ignore_rules/<direction>.shareignore
   e.g.,  mac_to_windows.shareignore, windows_to_mac.shareignore

3. Category-specific
   00_System/10_Config/ignore_rules/<category>.shareignore
   e.g.,  repos.shareignore, data.shareignore

4. Profile-specific (active --profile)
   00_System/10_Config/profiles/<profile>/.shareignore

5. Project-local (in the source path being sent)
   <source-path>/.shareignore

6. Inline CLI flag
   --ignore "<pattern>" (may be repeated)
```

Resolution: concatenate in order; later rules override earlier matches.
A `!pattern` in level N **un-blocks** what level <N had blocked.

---

## 5. Manifest schema

One JSON manifest per transfer batch, written to:
```
00_System/30_Manifests/<direction>/<transfer-id>.json
```

`<transfer-id>` format:
```
<YYYY-MM-DDTHHmmss+ZZZZ>__<source>__<target>__<category>__<batch-name>__v<NN>
```

### 5.1 Schema (v1)

```json
{
  "schema_version": 1,
  "tool": "shareguard",
  "tool_version": "0.1.0",

  "transfer_id": "2026-05-15T153000+0900__mac__windows__repos__gaon-api-clean__v01",
  "created_at": "2026-05-15T15:30:00+09:00",
  "completed_at": "2026-05-15T15:30:12+09:00",

  "direction": "mac_to_windows",
  "category": "repos",
  "batch_name": "gaon-api-clean",
  "version": 1,

  "source": {
    "host": "chans-macbook-pro.local",
    "user": "chan",
    "path": "/Users/chan/Developer/gaon-api"
  },

  "destination": {
    "share_path": "10_Exchange/10_Mac_to_Windows/20_Ready/10_Repos/",
    "primary_file": "2026-05-15__mac__windows__repos__gaon-api-clean__v01.zip"
  },

  "mode": "zip",
  "compression": { "algo": "deflate", "level": 6 },

  "files": [
    {
      "path": "2026-05-15__mac__windows__repos__gaon-api-clean__v01.zip",
      "size_bytes": 5242880,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "mtime": "2026-05-15T15:30:11+09:00"
    }
  ],

  "totals": {
    "files_scanned": 184,
    "files_included": 132,
    "files_excluded": 52,
    "files_blocked": 0,
    "bytes_in": 18874368,
    "bytes_out": 5242880
  },

  "rules_fired": [
    {"rule": "AUTO_EXCLUDE", "pattern": "node_modules/", "count": 45},
    {"rule": "AUTO_EXCLUDE", "pattern": ".DS_Store", "count": 7}
  ],

  "warnings": [],
  "blocks":   [],

  "checksum_file": "00_System/50_Checksums/mac_to_windows/2026-05-15T153000+0900__mac__windows__repos__gaon-api-clean__v01.sha256",
  "log_file":      "00_System/40_Logs/mac_to_windows/2026-05-15T153000+0900__mac__windows__repos__gaon-api-clean__v01.log",

  "state": "ready"
}
```

### 5.2 State field transitions

`staged` → `ready` → `received` → `archived`
or any state → `rejected` (terminal).

---

## 6. Checksum sidecar format

Plain `shasum -a 256` output (Mac/Linux compatible, also readable by
`certutil` after manual reformat if needed):

```
<sha256-hex>  <filename-relative-to-checksum-file's-direction-folder>
```

One file per batch:
```
00_System/50_Checksums/<direction>/<transfer-id>.sha256
```

Multi-file batches list one row per file in delivery order.

---

## 7. Archive rules

### 7.1 When to archive

Default policy (configurable):
- A file in `90_Received/` for > 30 days → eligible for `shareguard archive`.
- An explicit `shareguard archive <id>` runs immediately regardless of age.
- An `--auto-archive` flag on `shareguard receive` archives on successful verify.

### 7.2 Where it goes

```
90_Archive/<YYYY>/<YYYY-MM>/<direction>/<category>/<transfer-id>/
  ├── <files...>
  ├── <transfer-id>.json     ← copy of manifest
  └── <transfer-id>.sha256   ← copy of checksum
```

### 7.3 Index

```
90_Archive/_index/
  ├── by_date/<YYYY>/<YYYY-MM>.jsonl     ← one transfer per line
  ├── by_category/<category>.jsonl
  └── by_direction/<direction>.jsonl
```

`_index/*.jsonl` is append-only; rebuilt by `shareguard archive --reindex`.

---

## 8. Reject / quarantine behavior

### 8.1 `80_Rejected/`

When validation blocks a transfer, files (or representative samples for
huge trees) move to `80_Rejected/<category>/<transfer-id>/` with a sidecar:

```
80_Rejected/<category>/<transfer-id>/
  ├── <offending-files...>     ← actual files (or first 10 if a huge tree)
  └── <transfer-id>.reject.json
```

`reject.json` schema:
```json
{
  "transfer_id": "...",
  "rejected_at": "2026-05-16T10:22:00+09:00",
  "blocks": [
    {
      "rule": "RAW_SECRET",
      "path": "config/.env",
      "evidence": "filename matched .env pattern"
    }
  ],
  "warnings_overrideable": false,
  "source_summary": { "host": "...", "path": "...", "file_count": 1 }
}
```

Rejected items expire after 90 days unless promoted by operator review.

### 8.2 `80_Quarantine/` (share root, not per-direction)

For items that need *security* review beyond simple validation
(e.g., a future antivirus integration flags something). Manual workflow only —
ShareGuard never auto-routes to quarantine; an operator explicitly moves items
there with `shareguard quarantine <transfer-id> --reason "..."`.

---

## 9. Logging

Structured logs, one line per event, JSON Lines:

```
00_System/40_Logs/<direction>/<transfer-id>.log
```

Per-event fields:
```json
{"ts":"2026-05-15T15:30:00.123+09:00","level":"info","event":"stage.start","transfer_id":"...","detail":{...}}
{"ts":"...","level":"info","event":"validate.rule_fired","rule":"AUTO_EXCLUDE","pattern":"node_modules/","count":45}
{"ts":"...","level":"warn","event":"validate.warning","rule":"SMALL_FILE_HEAVY","files":1234}
{"ts":"...","level":"info","event":"checksum.write","path":"..."}
{"ts":"...","level":"info","event":"move.atomic","from":"...","to":"..."}
{"ts":"...","level":"info","event":"transfer.complete","state":"ready"}
```

Levels: `debug` `info` `warn` `error`.

---

## 10. Config file format

`00_System/10_Config/global/shareguard.toml`:

```toml
[paths]
share_root = "auto"                   # auto-detect via route_rules/bridge10g.routes.json
default_mount_point_mac = "/Volumes/Mac-Window_Share"
default_mount_point_mac_fallback = "~/mnt/Mac-Window_Share"

[validation]
fail_on_warning = false               # treat warnings as blocks
small_file_threshold_bytes = 16384
small_file_count_threshold  = 1000
large_tree_file_threshold   = 10000
large_tree_dir_threshold    = 50000
media_heavy_bytes           = 53687091200   # 50 GB

[ignore]
default_file = "00_System/10_Config/ignore_rules/default.shareignore"
respect_project_local = true

[manifest]
schema_version = 1
include_source_user = true
include_source_host = true
include_per_file_mtime = true

[archive]
auto_archive_on_receive = false
auto_archive_after_days = 30
reject_expiry_days = 90

[performance]
copy_buffer_size_bytes = 4194304       # 4 MB
parallel_hash_workers = 4
zip_compression_level = 6
```

---

## 11. Platform notes

| Concern | Mac | Windows |
|---------|-----|---------|
| Share path | `/Volumes/Mac-Window_Share` (or `~/mnt/…` fallback) | `\\192.168.50.1\Mac-Window_Share` or mapped drive |
| Hashing | `shasum -a 256` (Apple) | `certutil -hashfile … SHA256` (built-in) — internally use a single Rust/Go implementation |
| Filename normalization | NFC enforced on stage | UTF-8 passthrough |
| Long paths | n/a | enable `LongPathsEnabled` registry; reject otherwise |
| Atomic rename | OK on same SMB share | OK on same SMB share |
| Case sensitivity | APFS case-insensitive default | NTFS case-insensitive |

---

## 12. Implementation plan (recommendation, not part of spec)

Suggested language: **Rust** (single static binary, fast hashing, good Windows
support) or **Go** (simpler ops story, cross-compile trivial). Avoid Python for
this; bundling Python on Windows for end-users is friction.

Suggested layout:
```
00_System/20_Scripts/common_cli/
  ├── SHAREGUARD_SPEC.md      ← this file
  ├── shareguard               ← release binary (universal2 mac + x86_64-pc-windows-gnu)
  ├── src/                     ← source tree (or out-of-share repo synced here)
  │   ├── cli/
  │   ├── validation/
  │   ├── manifest/
  │   ├── checksum/
  │   ├── ignore/
  │   └── archive/
  └── tests/
```

Phase ordering:
1. `check` + `hash` + `verify` — read-only commands first (no risk of corruption).
2. `send --mode file` — single-file path.
3. `send --mode zip` — tree-mode with `.shareignore` integration.
4. `receive` + verify roundtrip.
5. `archive` + `_index`.
6. `status` + `doctor`.
7. GUI wrappers (Mac Finder Quick Action, Windows Explorer context menu).

---

## 13. Open questions

- Should `shareguard receive` move source files to `90_Received/` immediately, or wait for sender to confirm? (Currently spec'd as immediate on successful checksum.)
- Manifest signing — useful (proves provenance) but adds key management cost. Defer to v2.
- Per-batch retention policy override via `--retain <days>` — needed v1 or v2?
- AV integration: hook before stage, after stage, or on-demand only?
- Multi-user attribution: today only `macshare` SMB account writes. If we ever add more accounts, manifest's `source.user` should reflect the SMB account, not just the OS user.

---

*This document is normative for the ShareGuard implementation. Update it
before changing CLI behavior, not after.*
