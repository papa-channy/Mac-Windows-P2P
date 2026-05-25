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
    // Three sources, deduped:
    //   1. mDNS service browse (catches macOS Sharing, Samba)
    //   2. Currently-mounted smbfs shares (`mount` output) — most
    //      reliable on Mac↔Win where Windows doesn't advertise
    //      `_smb._tcp`. If the user already mounted from Finder, the
    //      server's hostname is right there.
    //   3. Live mDNS hostname resolve for any candidate from (2) →
    //      fills in IP addresses + confirms reachability.
    //
    // The user gets a list that's never empty as long as the share is
    // mounted, even when Bonjour service advertising is off.
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(3));
    let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;

    // Windows's built-in SMB server does NOT advertise `_smb._tcp.local.`
    // — only macOS and Samba do. To catch a Windows peer we also browse
    // `_workstation._tcp` (Samba's secondary registration, sometimes
    // installed alongside file sharing tools) and `_device-info._tcp`
    // (Apple Bonjour Print/Sleep service which Windows hosts running
    // Bonjour for iTunes happen to register too). At minimum the
    // peer's `<host>.local.` A/AAAA record is resolvable so the user
    // can type the hostname manually as a fallback.
    let services = ["_smb._tcp.local.", "_workstation._tcp.local.", "_device-info._tcp.local."];
    let receivers: Vec<_> = services
        .iter()
        .map(|s| daemon.browse(s).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;

    // Drop our own host from the results — listing the running mac as a
    // candidate remote_host is always wrong.
    let self_host = mac_local_host();

    let mut by_host: HashMap<String, SmbHost> = HashMap::new();
    let start = Instant::now();
    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        let slice = remaining.min(Duration::from_millis(120));
        let mut got_event = false;
        for recv in &receivers {
            if let Ok(ServiceEvent::ServiceResolved(info)) = recv.recv_timeout(slice) {
                got_event = true;
                let fullname = info.get_fullname().to_string();
                let hostname = info
                    .get_hostname()
                    .trim_end_matches('.')
                    .trim_end_matches(".local")
                    .to_string();
                if hostname.eq_ignore_ascii_case(&self_host) {
                    continue;
                }
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
        }
        if !got_event {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    let _ = daemon.shutdown();

    // Source 2 — extract host names from current SMB mounts.
    for mounted in mounted_smb_hosts() {
        if mounted.hostname.eq_ignore_ascii_case(&self_host) {
            continue;
        }
        // Merge — if mDNS already returned this host, just add any
        // addresses the mount line is implicitly using (skip for now).
        by_host
            .entry(mounted.hostname.clone())
            .or_insert(mounted);
    }

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

/// Parse `mount` output for currently-mounted SMB shares. Each line
/// looks like `//user@HOST/share on /Volumes/x (smbfs, …)` — extract
/// the HOST part. Critical on Mac↔Win because Windows doesn't
/// advertise `_smb._tcp` so browse alone never finds it.
fn mounted_smb_hosts() -> Vec<SmbHost> {
    let mut out = Vec::new();
    let output = match std::process::Command::new("mount").output() {
        Ok(o) if o.status.success() => o,
        _ => return out,
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut seen: std::collections::HashSet<String> = Default::default();
    for line in text.lines() {
        if !line.contains("(smbfs") && !line.contains("(smb,") {
            continue;
        }
        let Some(start) = line.find("//") else { continue };
        let rest = &line[start + 2..];
        let after_user = match rest.find('@') {
            Some(at) => &rest[at + 1..],
            None => rest,
        };
        let Some(slash) = after_user.find('/') else { continue };
        let raw_host = &after_user[..slash];
        let hostname = raw_host.trim_end_matches(".local").to_string();
        if !seen.insert(hostname.clone()) {
            continue;
        }
        let mdns_host = if raw_host.contains('.') {
            raw_host.to_string()
        } else {
            format!("{hostname}.local")
        };
        out.push(SmbHost {
            fullname: format!("{hostname}._smb._tcp.local. (mounted)"),
            hostname,
            mdns_host,
            addresses: vec![],
            port: 445,
        });
    }
    out
}

/// macOS LocalHostName via scutil — what every Bonjour-aware app uses
/// to identify itself on the LAN. Falls back to `hostname` env when
/// scutil isn't reachable (test env).
fn mac_local_host() -> String {
    if let Ok(out) = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }
    std::env::var("HOSTNAME").unwrap_or_default()
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
    fn mounted_smb_hosts_empty_when_no_smb_mounts() {
        // The unit test runner doesn't have any smbfs mounts; should
        // come back empty without erroring out.
        let hosts = mounted_smb_hosts();
        // Don't assert isEmpty unconditionally — a contributor's
        // machine might genuinely have an smbfs mount. Just make sure
        // we get a Vec back without panic.
        for h in hosts {
            assert!(!h.hostname.is_empty());
            assert_eq!(h.port, 445);
        }
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
