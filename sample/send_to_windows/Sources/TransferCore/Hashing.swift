// Hashing.swift — §4.4 SHA-256 산정.
//
// 파일 모드: 도착본 파일의 SHA-256.
// 폴더 모드: 폴더 내 모든 regular file에 대해
//   1. 폴더 root 기준 relative path 추출
//   2. lexicographic 정렬 (Swift String <, code point 기준)
//   3. 각 파일별로 "<rel-with-forward-slash>\0<file-sha256>\n" 라인 생성
//   4. 모든 라인 concat한 바이트열의 SHA-256 = combined dir-hash
//
// 경로 separator: 양쪽 호환을 위해 forward slash(/) 강제 (Mac native, Windows도 허용).
// Windows 측 구현(send-to-mac.ps1 line ~138-151)이 같은 약속을 따라야 함 → Phase 5 sync 시 확인.

import Foundation
import CryptoKit

public enum Hashing {

    public struct FileEntry: Sendable, Equatable {
        public let relativePath: String  // 폴더 root 기준, forward slash
        public let sha256: String        // hex lowercase
        public let sizeBytes: Int64
    }

    public struct DirectoryDigest: Sendable, Equatable {
        public let combined: String          // hex lowercase
        public let entries: [FileEntry]      // 정렬된 순서
        public let totalBytes: Int64
    }

    /// 파일 SHA-256 (streaming, 1MB 청크).
    public static func sha256(file: URL) throws -> String {
        let handle: FileHandle
        do {
            handle = try FileHandle(forReadingFrom: file)
        } catch {
            throw TransferError.ioError("open for hashing: \(file.path)", underlying: error)
        }
        defer { try? handle.close() }

        var hasher = SHA256()
        while true {
            let chunk: Data
            do {
                chunk = try handle.read(upToCount: 1_048_576) ?? Data()
            } catch {
                throw TransferError.ioError("read while hashing: \(file.path)", underlying: error)
            }
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hexLower(hasher.finalize())
    }

    /// 폴더 dir-hash. §4.4 알고리즘 그대로.
    public static func dirHash(folder: URL) throws -> DirectoryDigest {
        let entries = try walkRegularFiles(folder: folder)
            .sorted { $0.relativePath < $1.relativePath }   // lex sort

        var combined = SHA256()
        var totalBytes: Int64 = 0
        var richEntries: [FileEntry] = []
        richEntries.reserveCapacity(entries.count)

        for ent in entries {
            let fileSha = try sha256(file: ent.absoluteURL)
            let size = ent.sizeBytes
            totalBytes += size
            richEntries.append(FileEntry(relativePath: ent.relativePath,
                                         sha256: fileSha,
                                         sizeBytes: size))
            // "<rel>\0<sha>\n" — bytes
            var line = Data()
            line.append(ent.relativePath.data(using: .utf8)!)
            line.append(0x00)
            line.append(fileSha.data(using: .utf8)!)
            line.append(0x0A)
            combined.update(data: line)
        }

        return DirectoryDigest(combined: hexLower(combined.finalize()),
                               entries: richEntries,
                               totalBytes: totalBytes)
    }

    // MARK: — Internal

    private struct RawEntry {
        let relativePath: String
        let absoluteURL: URL
        let sizeBytes: Int64
    }

    private static func walkRegularFiles(folder: URL) throws -> [RawEntry] {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .isDirectoryKey]
        guard let enumerator = fm.enumerator(at: folder,
                                             includingPropertiesForKeys: keys,
                                             options: [.skipsHiddenFiles])
        else {
            throw TransferError.ioError("enumerate: \(folder.path)", underlying: nil)
        }

        // folder.path 끝에 separator 있는지 정규화
        let basePath = folder.standardizedFileURL.path
        let prefix = basePath.hasSuffix("/") ? basePath : basePath + "/"

        var out: [RawEntry] = []
        for case let url as URL in enumerator {
            let rv = try url.resourceValues(forKeys: Set(keys))
            guard rv.isRegularFile == true else { continue }

            let absPath = url.standardizedFileURL.path
            // relative path 추출 + forward slash 정규화
            guard absPath.hasPrefix(prefix) else { continue }  // 안전망
            var rel = String(absPath.dropFirst(prefix.count))
            rel = rel.replacingOccurrences(of: "\\", with: "/")
            // NFC 정규화 (HFS+/SMB NFD 회피)
            rel = rel.precomposedStringWithCanonicalMapping

            let size = Int64(rv.fileSize ?? 0)
            out.append(RawEntry(relativePath: rel,
                                absoluteURL: url,
                                sizeBytes: size))
        }
        return out
    }

    private static func hexLower<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        digest.map { String(format: "%02x", $0) }.joined()
    }
}
