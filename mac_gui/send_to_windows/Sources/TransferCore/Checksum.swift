// Checksum.swift — §4.6 sidecar 포맷.
//
// shasum -a 256 / sha256sum -c 호환:
//   <hex(lowercase)>  <filename>\n
// 헥스 두 칸 공백 파일명, LF 줄바꿈.
//
// 파일 모드: 1 line.
// 폴더 모드: 폴더 내부 모든 파일 라인 + 마지막에 combined dir-hash + "# combined dir-hash" 코멘트.
// 파일명은 NFC 정규화 (HFS+/SMB NFD 회피).

import Foundation

public enum Checksum {

    /// 파일 모드 sidecar 텍스트.
    public static func renderFile(sha256: String, filename: String) -> String {
        let nfc = filename.precomposedStringWithCanonicalMapping
        return "\(sha256)  \(nfc)\n"
    }

    /// 폴더 모드 sidecar 텍스트.
    /// - parameter folderName: 도착 후 폴더의 최종 이름 (네이밍 적용된).
    /// - parameter digest: Hashing.dirHash 결과.
    public static func renderDirectory(folderName: String,
                                       digest: Hashing.DirectoryDigest) -> String {
        let nfcFolder = folderName.precomposedStringWithCanonicalMapping
        var out = ""
        for ent in digest.entries {
            let nfcRel = ent.relativePath.precomposedStringWithCanonicalMapping
            out += "\(ent.sha256)  \(nfcFolder)/\(nfcRel)\n"
        }
        out += "\(digest.combined)  \(nfcFolder)  # combined dir-hash\n"
        return out
    }
}
