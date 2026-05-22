// swift-tools-version: 5.10
//
// send-to-windows-launcher — small Swift app that registers a macOS Service
// vendor ("Windows로 보내기") and forwards the selected file paths to the
// Tauri share-manager binary as `--send <path>` arguments.
//
// Equivalent in spirit to windows_gui/launcher.vbs.

import PackageDescription

let package = Package(
    name: "SendToWindowsLauncher",
    platforms: [.macOS(.v11)],
    products: [
        .executable(name: "SendToWindowsLauncher", targets: ["SendToWindowsLauncher"]),
    ],
    targets: [
        .executableTarget(
            name: "SendToWindowsLauncher",
            path: "Sources/SendToWindowsLauncher"
        ),
    ]
)
