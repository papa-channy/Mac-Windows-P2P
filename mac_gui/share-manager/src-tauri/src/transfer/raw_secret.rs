// raw_secret.rs — §5.1 RAW_SECRET block rules.
//
// PARITY (A안, 2026-06-10): block patterns are NOT hardcoded anymore.
// They are loaded from the SAME single source the Windows sender reads,
// so both OSes block identically (PARITY_MATRIX D3):
//
//   1. share policy.json  → `network_mode` + `secrets.always_blocked_patterns`
//   2. share `00_System/10_Config/ignore_rules/_secrets_policy/<mode>-network.shareignore`
//      (mode = "open" | "closed")
//
// Matching is PowerShell `-like`-compatible glob (`*`, `?`), case-
// insensitive, on the basename. Lines starting with `!` are negations
// (allow-exceptions, e.g. `!.env.example`) — gitignore-style, so a
// template file is not blocked even when `.env.*` would match.
//
// If the share policy can't be read (offline / first run), we fall back
// to the most conservative built-in set (= the open-network list, which
// blocks everything) so we never fail OPEN on secrets.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub rule: String,
    pub pattern: String,
}

/// Conservative fallback when the share policy is unreadable. Mirrors the
/// share's `open-network.shareignore` (block-everything) plus negations.
const DEFAULT_PATTERNS: &[&str] = &[
    ".env",
    ".env.*",
    "!.env.example",
    "!.env.template",
    "!.env.sample",
    "*.pem",
    "*.key",
    "*.cer",
    "*.crt",
    "*.p12",
    "*.pfx",
    "*.mobileprovision",
    "service-account*.json",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
    "*.gpg.key",
    "*.kdbx",
    "secrets.yaml",
    "secrets.yml",
    "secrets.json",
    "credentials.json",
];

fn secrets_policy_path(mode: &str) -> std::path::PathBuf {
    let file = if mode == "open" {
        "open-network.shareignore"
    } else {
        "closed-network.shareignore"
    };
    crate::share::share_root()
        .join("00_System")
        .join("10_Config")
        .join("ignore_rules")
        .join("_secrets_policy")
        .join(file)
}

/// Build the active block-pattern list from the share policy (or fall
/// back to DEFAULT_PATTERNS). Same precedence the Windows sender uses:
/// policy.json `always_blocked_patterns` + the network-mode shareignore.
fn load_block_patterns() -> Vec<String> {
    let mut pats: Vec<String> = Vec::new();
    let mut network_mode = "closed".to_string();

    if let Ok(policy) = crate::policy::load() {
        if let Some(nm) = policy.get("network_mode").and_then(|v| v.as_str()) {
            network_mode = nm.to_string();
        }
        if let Some(arr) = policy
            .get("secrets")
            .and_then(|s| s.get("always_blocked_patterns"))
            .and_then(|a| a.as_array())
        {
            for p in arr {
                if let Some(s) = p.as_str() {
                    pats.push(s.to_string());
                }
            }
        }
    }

    if let Ok(content) = std::fs::read_to_string(secrets_policy_path(&network_mode)) {
        for line in content.lines() {
            let t = line.trim();
            if t.is_empty() || t.starts_with('#') {
                continue;
            }
            pats.push(t.to_string());
        }
    }

    if pats.is_empty() {
        return DEFAULT_PATTERNS.iter().map(|s| s.to_string()).collect();
    }
    pats
}

/// PowerShell `-like`-compatible glob: `*` = any run, `?` = one char.
/// Inputs are already lowercased by the caller.
fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = name.chars().collect();
    let (mut pi, mut si) = (0usize, 0usize);
    let (mut star, mut mark) = (None::<usize>, 0usize);
    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = si;
            pi += 1;
        } else if let Some(st) = star {
            pi = st + 1;
            mark += 1;
            si = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

pub fn check(filename: &str) -> Option<Match> {
    let lower = filename.to_lowercase();
    let patterns = load_block_patterns();

    // Split into allow (negation `!`) and block. Allow wins — a template
    // like `.env.example` listed as `!.env.example` is never blocked even
    // though `.env.*` would otherwise match.
    let mut allow: Vec<String> = Vec::new();
    let mut block: Vec<String> = Vec::new();
    for p in &patterns {
        if let Some(neg) = p.strip_prefix('!') {
            allow.push(neg.to_lowercase());
        } else {
            block.push(p.to_lowercase());
        }
    }

    for a in &allow {
        if glob_match(a, &lower) {
            return None;
        }
    }
    for b in &block {
        if glob_match(b, &lower) {
            return Some(Match {
                rule: "RAW_SECRET (_secrets_policy)".to_string(),
                pattern: b.clone(),
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::ENV_LOCK;

    /// Run a closure with MW_SHARE_ROOT pointed at an empty tempdir so
    /// the share policy is absent → check() uses DEFAULT_PATTERNS. Keeps
    /// these tests deterministic regardless of a real mounted share.
    fn with_default_patterns<F: FnOnce()>(f: F) {
        let _g = ENV_LOCK.lock().unwrap();
        let td = tempfile::tempdir().unwrap();
        let prev = std::env::var("MW_SHARE_ROOT").ok();
        std::env::set_var("MW_SHARE_ROOT", td.path());
        f();
        match prev {
            Some(v) => std::env::set_var("MW_SHARE_ROOT", v),
            None => std::env::remove_var("MW_SHARE_ROOT"),
        }
    }

    #[test]
    fn blocks_env_exact() {
        with_default_patterns(|| {
            assert!(check(".env").is_some());
            assert!(check(".ENV").is_some());
            assert!(check(".env.local").is_some());
        });
    }

    #[test]
    fn does_not_block_env_example() {
        with_default_patterns(|| {
            assert!(check(".env.example").is_none());
            assert!(check(".env.template").is_none());
            assert!(check("env").is_none());
        });
    }

    #[test]
    fn blocks_pem_p12_mobileprovision() {
        with_default_patterns(|| {
            assert!(check("server.pem").is_some());
            assert!(check("ID.P12").is_some());
            assert!(check("foo.mobileprovision").is_some());
        });
    }

    #[test]
    fn blocks_service_account_json() {
        with_default_patterns(|| {
            assert!(check("service-account-prod.json").is_some());
            assert!(check("service-account.json").is_some());
        });
    }

    #[test]
    fn blocks_ssh_private_keys() {
        // The gap that let Mac→Win leak ssh keys (D3): now covered.
        with_default_patterns(|| {
            assert!(check("id_rsa").is_some());
            assert!(check("id_ed25519").is_some());
            assert!(check("id_ecdsa").is_some());
        });
    }

    #[test]
    fn share_policy_closed_mode_overrides_defaults() {
        // A안 핵심: closed 모드면 .env 는 허용(개발 시크릿 공유), ssh키/서명키만
        // 차단 — Windows sender 와 동일 정책 소스를 읽기 때문.
        let _g = ENV_LOCK.lock().unwrap();
        let td = tempfile::tempdir().unwrap();
        let prev = std::env::var("MW_SHARE_ROOT").ok();
        std::env::set_var("MW_SHARE_ROOT", td.path());

        let cfg = td.path().join("00_System/10_Config/global");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::write(
            cfg.join("policy.json"),
            r#"{"network_mode":"closed","secrets":{"always_blocked_patterns":["service-account*.json"]}}"#,
        )
        .unwrap();
        let sp = td.path().join("00_System/10_Config/ignore_rules/_secrets_policy");
        std::fs::create_dir_all(&sp).unwrap();
        std::fs::write(
            sp.join("closed-network.shareignore"),
            "service-account*.json\n*.p12\nid_rsa\nid_ed25519\n",
        )
        .unwrap();

        assert!(check(".env").is_none(), "closed 모드는 .env 허용");
        assert!(check("server.pem").is_none(), "closed 모드는 .pem 허용");
        assert!(check("id_rsa").is_some(), "closed 모드도 ssh 개인키 차단");
        assert!(check("cert.p12").is_some(), "closed 모드는 서명 키 차단");

        match prev {
            Some(v) => std::env::set_var("MW_SHARE_ROOT", v),
            None => std::env::remove_var("MW_SHARE_ROOT"),
        }
    }
}
