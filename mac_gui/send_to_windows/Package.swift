// swift-tools-version: 5.10
//
// SendToWindows — Mac↔Windows 10GbE 셰어 송수신 GUI/CLI
//
// 빌드:   swift build -c release
// 테스트: swift test
// 번들:   scripts/bundle-app.sh   (실행파일 → .app 패키징)
//
// 캐노니컬 소스: 셰어 측 00_System/20_Scripts/mac_gui/send_to_windows/
//                네트워크 단절 시엔 ~/Developer/send_to_windows/에서 작업 후 sync.

import PackageDescription

let package = Package(
    name: "SendToWindows",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "SendToWindows", targets: ["SendToWindows"]),
        .library(name: "TransferCore",     targets: ["TransferCore"]),
    ],
    targets: [
        // 순수 로직 — UI 의존성 없음, 단위 테스트 대상.
        .target(
            name: "TransferCore",
            path: "Sources/TransferCore"
        ),

        // GUI 앱 (AppKit + SwiftUI). TransferCore 의존.
        .executableTarget(
            name: "SendToWindows",
            dependencies: ["TransferCore"],
            path: "Sources/SendToWindows"
        ),

        // 단위 테스트.
        .testTarget(
            name: "TransferCoreTests",
            dependencies: ["TransferCore"],
            path: "Tests/TransferCoreTests"
        ),
    ]
)
