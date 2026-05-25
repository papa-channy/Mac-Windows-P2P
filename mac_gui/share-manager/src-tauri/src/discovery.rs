// discovery.rs — mDNS browse for SMB hosts on the local subnet.
//
// When a user moves between networks (home / office / direct-link) the
// Windows host's IP changes but the hostname stays the same. Rather
// than make the user re-enter the IP into Settings → Network every
// time, we browse `_smb._tcp.local.` and let them pick from a list.
//
// Public surface:
//   discover_smb_hosts(timeout_secs: Option<u64>) -> Vec<SmbHost>
//
// The default browse window is 3 seconds — long enough for most LAN
// peers to respond, short enough that the user doesn't think the
// button hung. Returns deduped (by hostname) results, sorted with
// peers that look like Windows machines (have `DESKTOP-` or `WIN-`
// prefix) first because that's almost always what the user wants.

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SmbHost {
    /// fully qualified mDNS name, e.g. "DESKTOP-Q0S7LSQ._smb._tcp.local."
    pub fullname: String,
    /// short hostname, e.g. "DESKTOP-Q0S7LSQ"
    pub hostname: String,
    /// `.local` hostname suitable for SMB mounts, e.g. "DESKTOP-Q0S7LSQ.local"
    pub mdns_host: String,
    /// resolved IPv4 + IPv6 addresses (IPv4 first when present)
    pub addresses: Vec<String>,
    pub port: u16,
}

#[tauri::command]
pub fn discover_smb_hosts(timeout_secs: Option<u64>) -> Result<Vec<SmbHost>, String> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(3));
    let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = daemon
        .browse("_smb._tcp.local.")
        .map_err(|e| e.to_string())?;

    let mut by_host: HashMap<String, SmbHost> = HashMap::new();
    let start = Instant::now();
    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let fullname = info.get_fullname().to_string();
                // Bonjour fullnames are "<instance>._smb._tcp.local." —
                // the instance part is what we want for short hostname.
                let hostname = info
                    .get_hostname()
                    .trim_end_matches('.')
                    .trim_end_matches(".local")
                    .to_string();
                let mdns_host = format!("{hostname}.local");
                let mut addrs: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .map(|a: &IpAddr| a.to_string())
                    .collect();
                addrs.sort_by_key(|s| !s.contains(':')); // IPv4 first
                let entry = by_host
                    .entry(hostname.clone())
                    .or_insert_with(|| SmbHost {
                        fullname: fullname.clone(),
                        hostname: hostname.clone(),
                        mdns_host,
                        addresses: vec![],
                        port: info.get_port(),
                    });
                for a in addrs {
                    if !entry.addresses.contains(&a) {
                        entry.addresses.push(a);
                    }
                }
            }
            // Non-resolved events (SearchStarted, ServiceFound …) — ignore.
            Ok(_) => {}
            // recv_timeout fires repeatedly; just loop until we hit our window.
            Err(_) => {}
        }
    }
    let _ = daemon.shutdown();

    let mut out: Vec<SmbHost> = by_host.into_values().collect();
    out.sort_by(|a, b| {
        // Windows machines first (matches the dominant use case), then
        // alphabetical so the order is stable across browses.
        let win_a = is_likely_windows(&a.hostname);
        let win_b = is_likely_windows(&b.hostname);
        match (win_a, win_b) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.hostname.cmp(&b.hostname),
        }
    });
    Ok(out)
}

fn is_likely_windows(hostname: &str) -> bool {
    let h = hostname.to_ascii_uppercase();
    h.starts_with("DESKTOP-") || h.starts_with("WIN-") || h.starts_with("LAPTOP-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_hostname_heuristic() {
        assert!(is_likely_windows("DESKTOP-Q0S7LSQ"));
        assert!(is_likely_windows("desktop-abc"));
        assert!(is_likely_windows("WIN-1234"));
        assert!(is_likely_windows("LAPTOP-XYZ"));
        assert!(!is_likely_windows("chanui-MacBookPro"));
        assert!(!is_likely_windows("my-nas"));
    }

    #[test]
    fn smbhost_json_shape_stable() {
        let h = SmbHost {
            fullname: "X._smb._tcp.local.".into(),
            hostname: "X".into(),
            mdns_host: "X.local".into(),
            addresses: vec!["192.168.1.5".into()],
            port: 445,
        };
        let v = serde_json::to_value(&h).unwrap();
        assert!(v.get("hostname").is_some());
        assert!(v.get("mdns_host").is_some());
        assert!(v.get("addresses").unwrap().as_array().unwrap().len() == 1);
    }
}
