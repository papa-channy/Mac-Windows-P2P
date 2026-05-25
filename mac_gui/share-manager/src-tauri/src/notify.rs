// notify.rs — multi-channel notification dispatch.
//
// Read NotificationSettings from disk, fan out a single event to:
//   - macOS native banner (tauri-plugin-notification, in-process)
//   - Webhook (Slack/Discord-compatible JSON payload)
//
// Called from transfer engine + auto-verify + future hooks. Best-
// effort — never returns Err, never blocks the originating op. The
// op's success/failure has already been recorded in log_hub; notify
// is purely user-facing alerting.

use crate::share::Settings;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Copy)]
pub enum NotifyEvent {
    SendOk,
    SendFail,
    VerifyOk,
    VerifyFail,
    Clipboard,
}

/// Should this event fire under the user's current preferences?
fn allowed(settings: &crate::share::NotificationSettings, ev: NotifyEvent) -> bool {
    if !settings.enabled {
        return false;
    }
    match ev {
        NotifyEvent::SendOk => settings.on_send_ok,
        NotifyEvent::SendFail => settings.on_send_fail,
        NotifyEvent::VerifyOk => settings.on_verify_ok,
        NotifyEvent::VerifyFail => settings.on_verify_fail,
        NotifyEvent::Clipboard => settings.on_clipboard,
    }
}

/// Single fan-out point. Spawns a thread for the webhook POST so the
/// caller's hot path stays under ~1ms even if the webhook is slow.
pub fn dispatch(app: &tauri::AppHandle, ev: NotifyEvent, title: &str, body: &str) {
    let settings = read_settings(app);
    if !allowed(&settings.notifications, ev) {
        return;
    }
    if settings.notifications.native {
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
    let webhook = settings.notifications.webhook_url.trim().to_string();
    if !webhook.is_empty() {
        let title = title.to_string();
        let body = body.to_string();
        std::thread::spawn(move || {
            let _ = post_webhook(&webhook, &title, &body);
        });
    }
}

#[derive(Serialize)]
struct SlackPayload<'a> {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<&'a str>,
}

fn post_webhook(url: &str, title: &str, body: &str) -> Result<(), String> {
    // Slack / Discord-compatible — "text" field is the only required
    // key. Two-line markdown so both ends render readably.
    let payload = SlackPayload {
        text: format!("*{title}*\n{body}"),
        username: Some("share-manager"),
    };
    ureq::post(url)
        .timeout(Duration::from_secs(5))
        .set("Content-Type", "application/json")
        .send_json(serde_json::to_value(&payload).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|p| p.join("settings.json"))
        .unwrap_or_else(|_| PathBuf::from("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> Settings {
    let p = settings_path(app);
    let raw = match std::fs::read_to_string(&p) {
        Ok(s) => s,
        Err(_) => return Settings::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}
