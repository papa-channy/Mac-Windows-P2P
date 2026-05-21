// transfer/ — port of mac_gui/sample/send_to_windows/Sources/TransferCore.
//
// Output must be byte-identical to the Windows-side phase-1 shim:
//   - manifest JSON: serde_json with sorted keys (BTreeMap path) + pretty
//   - checksum sidecar: "<sha>  <name>\n" lines (two-space separator, LF)
//   - dir-hash: lex-sorted "<rel>\0<sha>\n" lines, hashed
//   - filename NFC normalization

pub mod checksum;
pub mod engine;
pub mod errors;
pub mod hashing;
pub mod log;
pub mod manifest;
pub mod naming;
pub mod raw_secret;
pub mod sent_history;
pub mod timestamps;

pub use errors::TransferError;
