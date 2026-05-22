// raw_secret.rs — port of RawSecret.swift. §5.1 RAW_SECRET block rules.
// Case-insensitive basename match. Same set as Swift; future policy.json
// `_secrets_policy/*-network.shareignore` will extend this dynamically.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub rule: String,
    pub pattern: String,
}

const EXACT: &[(&str, &str, &str)] = &[
    (".env",                ".env (exact)",     ".env"),
    (".env.production",     ".env.production",  ".env.production"),
    (".env.local",          ".env.local",       ".env.local"),
    (".env.development",    ".env.development", ".env.development"),
];

const SUFFIX: &[(&str, &str, &str)] = &[
    (".pem",             "PEM file",         "*.pem"),
    (".key",             "Private key",      "*.key"),
    (".p12",             "PKCS#12 keystore", "*.p12"),
    (".mobileprovision", "iOS provisioning", "*.mobileprovision"),
];

pub fn check(filename: &str) -> Option<Match> {
    let lower = filename.to_lowercase();

    for (name, rule, pattern) in EXACT {
        if lower == *name {
            return Some(Match { rule: rule.to_string(), pattern: pattern.to_string() });
        }
    }
    for (sfx, rule, pattern) in SUFFIX {
        if lower.ends_with(sfx) {
            return Some(Match { rule: rule.to_string(), pattern: pattern.to_string() });
        }
    }
    if lower.starts_with("service-account") && lower.ends_with(".json") {
        return Some(Match {
            rule: "Service account JSON".to_string(),
            pattern: "service-account*.json".to_string(),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_env_exact() {
        assert!(check(".env").is_some());
        assert!(check(".ENV").is_some());
        assert!(check(".env.local").is_some());
    }
    #[test]
    fn does_not_block_env_example() {
        assert!(check(".env.example").is_none());
        assert!(check("env").is_none());
    }
    #[test]
    fn blocks_pem_p12_mobileprovision() {
        assert!(check("server.pem").is_some());
        assert!(check("ID.P12").is_some());
        assert!(check("foo.mobileprovision").is_some());
    }
    #[test]
    fn blocks_service_account_json() {
        assert!(check("service-account-prod.json").is_some());
        assert!(check("service-account.json").is_some());
    }
}
