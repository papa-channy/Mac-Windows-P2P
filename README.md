# Mac-Windows-P2P

Direct-link file-transfer toolkit between macOS and Windows over a private 10GbE link (no cloud, no NAS). The shared root sits on the Windows host as an SMB share; this repo holds the **source code** for the CLI engine and the Mac / Windows GUI wrappers around it.

## Layout

```
common_cli/        Rust CLI engine ("shareguard") — validation, checksums, manifests
mac_gui/           macOS side: AppleScript Finder action, install scripts,
                   and `send_to_windows/` (Swift / SwiftUI app + TransferCore lib)
windows_gui/       Windows side: PowerShell entrypoints + `share-manager/`
                   (Tauri app: HTML/CSS/JS frontend, Rust backend)
```

Empty placeholder folders from the source tree (`mac_to_windows/`, `windows_to_mac/`) are not included.

## Build

| Component | Tooling | From |
| --- | --- | --- |
| `common_cli` | `cargo build --release` | `common_cli/` |
| `mac_gui/send_to_windows` | `swift build -c release` | `mac_gui/send_to_windows/` |
| `windows_gui/share-manager` | `cargo tauri build` (Tauri v2) | `windows_gui/share-manager/` |

PowerShell scripts under `windows_gui/` are entrypoints — no build step.

## See also

- [`common_cli/SHAREGUARD_SPEC.md`](common_cli/SHAREGUARD_SPEC.md) — CLI design / command spec
- [`mac_gui/WINDOWS_PARITY_BRIEF.md`](mac_gui/WINDOWS_PARITY_BRIEF.md) — feature parity notes between platforms
- [`mac_gui/send_to_windows/README.md`](mac_gui/send_to_windows/README.md) — Mac app details

## License

Dual-licensed under MIT OR Apache-2.0 (see [LICENSE](LICENSE)).
