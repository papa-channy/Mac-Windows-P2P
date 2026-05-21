// Naming.swift — §4.3 네이밍 규칙.
//
//   <YYYY-MM-DD>__<category-key>__<basename>__v<NN><ext>
//
// 규칙:
// - category-key는 영문 소문자 (한글 라벨 X)
// - basename은 원본 파일/폴더 이름의 확장자 제외 부분 그대로 (한글/공백 허용)
// - 폴더 전송 시 ext 없음 (빈 문자열)
// - basename은 NFC 정규화 (HFS+/SMB NFD 변환 이슈 회피)
// - 버전 v01~v99 (2자리 zero pad)

import Foundation

public enum Naming {

    public struct Components: Sendable, Equatable {
        public let date: String        // "2026-05-18"
        public let categoryKey: String // "documents"
        public let basename: String    // "예상 공수 산정 근거" (NFC)
        public let version: Int        // 1
        public let ext: String         // ".html" or "" for folder

        public init(date: String, categoryKey: String, basename: String, version: Int, ext: String) {
            self.date = date
            self.categoryKey = categoryKey
            self.basename = basename
            self.version = version
            self.ext = ext
        }
    }

    /// 사용자 원본 경로(URL)에서 basename + ext 추출.
    /// 폴더면 ext = "", basename = 폴더명.
    /// 파일이면 ext = lastPathComponent의 마지막 "."부터 끝까지 (점 포함).
    public static func split(originalURL url: URL,
                             isDirectory: Bool) -> (basename: String, ext: String) {
        let name = url.lastPathComponent.precomposedStringWithCanonicalMapping
        if isDirectory {
            return (name, "")
        }
        // 마지막 '.' 위치. 첫 글자가 '.'인 dotfile은 ext 없는 것으로 취급.
        if let dotIdx = name.lastIndex(of: "."), dotIdx != name.startIndex {
            let basename = String(name[..<dotIdx])
            let ext = String(name[dotIdx...])
            return (basename, ext)
        }
        return (name, "")
    }

    /// 컴포넌트 → 파일명 문자열.
    public static func render(_ c: Components) -> String {
        let v = String(format: "v%02d", c.version)
        return "\(c.date)__\(c.categoryKey)__\(c.basename)__\(v)\(c.ext)"
    }

    /// 편의: date + 카테고리 + 원본 URL + 버전 → 최종 파일명.
    public static func render(date: Date = .init(),
                              category: TransferCategory,
                              originalURL: URL,
                              isDirectory: Bool,
                              version: Int = 1,
                              timeZone: TimeZone = .current) -> String {
        let (basename, ext) = split(originalURL: originalURL, isDirectory: isDirectory)
        let c = Components(
            date: Timestamps.filenameDate(date, timeZone: timeZone),
            categoryKey: category.key,
            basename: basename,
            version: version,
            ext: ext
        )
        return render(c)
    }

    /// 파일명 역파싱. 형식 안 맞으면 nil.
    /// 주의: basename에 "__" 포함될 수 있어서 (예: "my__report"), 끝에서부터 토큰화.
    public static func parse(_ filename: String) -> Components? {
        let nfc = filename.precomposedStringWithCanonicalMapping

        // ext 분리 (basename 토큰화 전에)
        var stem: String
        var ext: String
        if let dotIdx = nfc.lastIndex(of: "."), dotIdx != nfc.startIndex {
            stem = String(nfc[..<dotIdx])
            ext  = String(nfc[dotIdx...])
        } else {
            stem = nfc
            ext  = ""
        }

        // 끝에서 "__v<NN>" 추출
        guard let vRange = stem.range(of: #"__v\d{2}$"#, options: .regularExpression) else {
            return nil
        }
        let vToken = String(stem[vRange]).dropFirst(3)   // "v01" → "01"
        guard let version = Int(vToken) else { return nil }
        stem = String(stem[..<vRange.lowerBound])

        // 앞에서 "<date>__<category>__" 추출
        let parts = stem.components(separatedBy: "__")
        guard parts.count >= 3 else { return nil }
        let date = parts[0]
        let categoryKey = parts[1]
        let basename = parts[2...].joined(separator: "__")

        // 형식 검증
        guard date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
            return nil
        }
        guard !categoryKey.isEmpty, !basename.isEmpty else { return nil }

        return Components(date: date, categoryKey: categoryKey,
                          basename: basename, version: version, ext: ext)
    }
}
