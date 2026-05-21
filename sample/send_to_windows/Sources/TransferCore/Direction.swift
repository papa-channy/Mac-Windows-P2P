// Direction.swift — §4.2 방향 매핑.

import Foundation

public enum TransferDirection: String, Sendable, Codable, CaseIterable {
    case macToWindows  = "mac_to_windows"
    case windowsToMac  = "windows_to_mac"

    /// `10_Exchange/10_Mac_to_Windows` / `10_Exchange/20_Windows_to_Mac`
    public var exchangeFolder: String {
        switch self {
        case .macToWindows: return "10_Exchange/10_Mac_to_Windows"
        case .windowsToMac: return "10_Exchange/20_Windows_to_Mac"
        }
    }

    public var source: String {
        switch self {
        case .macToWindows: return "mac"
        case .windowsToMac: return "windows"
        }
    }

    public var target: String {
        switch self {
        case .macToWindows: return "windows"
        case .windowsToMac: return "mac"
        }
    }
}
