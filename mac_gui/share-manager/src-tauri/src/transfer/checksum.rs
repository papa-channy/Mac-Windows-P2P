// checksum.rs — port of Checksum.swift. §4.6 sidecar format.
//
// shasum -a 256 / sha256sum -c compatible:
//   "<hex>  <name>\n"  (two-space separator, LF line endings)
//
// Folder mode lists every contained file plus a final combined dir-hash
// line annotated with "# combined dir-hash". The Windows-side comment is
// optional metadata; shareguard verify treats `#`-prefixed lines as
// comments.

use unicode_normalization::UnicodeNormalization;

use super::hashing::DirectoryDigest;

pub fn render_file(sha256: &str, filename: &str) -> String {
    let nfc: String = filename.nfc().collect();
    format!("{sha256}  {nfc}\n")
}

pub fn render_directory(folder_name: &str, digest: &DirectoryDigest) -> String {
    let nfc_folder: String = folder_name.nfc().collect();
    let mut out = String::new();
    for e in &digest.entries {
        let nfc_rel: String = e.relative_path.nfc().collect();
        out.push_str(&format!("{}  {nfc_folder}/{nfc_rel}\n", e.sha256));
    }
    out.push_str(&format!(
        "{}  {nfc_folder}  # combined dir-hash\n",
        digest.combined
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_line_uses_two_space_separator() {
        let line = render_file("abc", "foo.txt");
        assert_eq!(line, "abc  foo.txt\n");
    }
}
