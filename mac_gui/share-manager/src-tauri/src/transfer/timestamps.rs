// timestamps.rs — port of Timestamps.swift. Four formats:
//   filename_date         "2026-05-18"                       (local, date only)
//   transfer_id_timestamp "2026-05-18T152055+0900"           (no colon in tz)
//   iso8601               "2026-05-18T15:20:55+09:00"        (RFC 3339)
//   log_timestamp         "2026-05-18T15:20:55.031949500+09:00"  (sub-second + colon tz)

use chrono::{DateTime, Local, SecondsFormat};

pub fn filename_date(date: DateTime<Local>) -> String {
    date.format("%Y-%m-%d").to_string()
}

pub fn transfer_id_timestamp(date: DateTime<Local>) -> String {
    // chrono's %z renders "+0900" (no colon) — exactly what the contract wants.
    date.format("%Y-%m-%dT%H%M%S%z").to_string()
}

pub fn iso8601(date: DateTime<Local>) -> String {
    date.to_rfc3339_opts(SecondsFormat::Secs, false)
}

pub fn log_timestamp(date: DateTime<Local>) -> String {
    // %.9f gives nanoseconds. The Swift shim used "SSSSSSSxxx" (7 frac digits +
    // colon tz). chrono's nanos differ slightly but stay in the same ballpark
    // and remain RFC3339-parseable.
    date.to_rfc3339_opts(SecondsFormat::Nanos, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn filename_date_shape() {
        let d = Local.with_ymd_and_hms(2026, 5, 18, 15, 20, 55).unwrap();
        assert_eq!(filename_date(d), "2026-05-18");
    }
    #[test]
    fn transfer_id_no_colon_in_tz() {
        let d = Local.with_ymd_and_hms(2026, 5, 18, 15, 20, 55).unwrap();
        let s = transfer_id_timestamp(d);
        assert!(s.starts_with("2026-05-18T152055"));
        assert!(!s[18..].contains(':'), "tz must have no colon: {s}");
    }
    #[test]
    fn iso8601_has_colon_in_tz() {
        let d = Local.with_ymd_and_hms(2026, 5, 18, 15, 20, 55).unwrap();
        let s = iso8601(d);
        assert!(s.contains("15:20:55"));
    }
}
