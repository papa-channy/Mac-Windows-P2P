# Mac-Windows-P2P

Direct-link file-transfer toolkit between macOS and Windows over a private 10GbE link (no cloud, no NAS). The shared root sits on the Windows host as an SMB share; this repo holds the **source code** for the CLI engine and the Mac / Windows GUI wrappers around it.

## Layout

```
common_cli/        Rust CLI engine ("shareguard") — validation, checksums, manifests
mac_gui/           macOS side: AppleScript Finder action, install scripts,
                   `share-manager/` (Tauri v2 + React, mirrors Windows GUI),
                   and `send-to-windows-launcher/` (small Swift app vending
                   the macOS Service that feeds files into share-manager)
windows_gui/       Windows side: PowerShell entrypoints + `share-manager/`
                   (Tauri app: HTML/CSS/JS frontend, Rust backend)
sample/            Reference: the old Swift `send_to_windows` app the Mac
                   Tauri port was derived from. Kept for documentation only.
```

Empty placeholder folders from the source tree (`mac_to_windows/`, `windows_to_mac/`) are not included.

## Build

| Component | Tooling | From |
| --- | --- | --- |
| `common_cli` | `cargo build --release` | `common_cli/` |
| `mac_gui/share-manager` | `cargo tauri build` (Tauri v2 + React/Vite) | `mac_gui/share-manager/` |
| `mac_gui/send-to-windows-launcher` | `swift build -c release` + `scripts/bundle.sh` | `mac_gui/send-to-windows-launcher/` |
| `windows_gui/share-manager` | `cargo tauri build` (Tauri v2) | `windows_gui/share-manager/` |

PowerShell scripts under `windows_gui/` are entrypoints — no build step. On Mac,
`mac_gui/install.sh` builds & installs both the Tauri app and the Service
launcher if their source trees sit alongside it.

### Mac dev deps
- Xcode CLT (`xcode-select --install`)
- Rust + `cargo install tauri-cli --version '^2'`
- Node 20+ (for Vite frontend)

## See also

- [`common_cli/SHAREGUARD_SPEC.md`](common_cli/SHAREGUARD_SPEC.md) — CLI design / command spec
- [`mac_gui/WINDOWS_PARITY_BRIEF.md`](mac_gui/WINDOWS_PARITY_BRIEF.md) — feature parity notes between platforms
- [`sample/send_to_windows/README.md`](sample/send_to_windows/README.md) — original Swift app (reference only; superseded by `mac_gui/share-manager/`)

## License

Dual-licensed under MIT OR Apache-2.0 (see [LICENSE](LICENSE)).
