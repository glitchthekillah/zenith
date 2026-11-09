// Updates: the Windows installer and the AppImage update themselves (signed, from the
// GitHub release's latest.json). The .deb, and builds without an updater key, get a link.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

pub const PUBKEY: &str = include_str!("../updater.pub");

pub fn repo() -> String {
    let pkg: Value = serde_json::from_str(include_str!("../../package.json")).unwrap_or(Value::Null);
    pkg["zenith"]["repo"].as_str().unwrap_or("").to_string()
}

pub fn can_self_update() -> bool {
    !cfg!(debug_assertions)
        && !PUBKEY.trim().is_empty()
        && !repo().is_empty()
        && (cfg!(windows) && !portable() || std::env::var_os("APPIMAGE").is_some())
}

/// The portable Windows exe (no installer) can't update itself; it gets a download link instead
pub fn portable() -> bool {
    std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase().contains("portable"))).unwrap_or(false)
}

#[derive(Default)]
pub struct Pending(pub Mutex<Option<(Update, Vec<u8>)>>);

pub fn newer(a: &str, b: &str) -> bool {
    let p = |s: &str| s.split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let (x, y) = (p(a), p(b));
    for i in 0..3 {
        let (l, r) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if l != r { return l > r; }
    }
    false
}

pub async fn check(app: AppHandle) -> Value {
    use tauri::Manager;
    if can_self_update() {
        if app.state::<Pending>().0.lock().unwrap().is_some() { return json!({ "self": true }); }
        let endpoint = format!("https://github.com/{}/releases/latest/download/latest.json", repo());
        let Ok(url) = endpoint.parse() else { return json!({ "self": true }) };
        let updater = app.updater_builder().pubkey(PUBKEY.trim()).endpoints(vec![url]).and_then(|b| b.build());
        let Ok(updater) = updater else { return json!({ "self": true }) };
        match updater.check().await {
            Ok(Some(u)) => {
                let version = u.version.clone();
                crate::send(&app, "update", json!({ "state": "downloading", "version": version }));
                let (mut got, mut last) = (0usize, 0u64);
                let a2 = app.clone();
                let bytes = u.download(move |chunk, total| {
                    got += chunk;
                    if let Some(t) = total.filter(|t| *t > 0) {
                        let pct = (got as u64 * 100 / t).min(100);
                        if pct != last { last = pct; crate::send(&a2, "update", json!({ "state": "downloading", "percent": pct })); }
                    }
                }, || {}).await;
                match bytes {
                    Ok(b) => {
                        *app.state::<Pending>().0.lock().unwrap() = Some((u, b));
                        crate::send(&app, "update", json!({ "state": "ready", "version": version }));
                    }
                    Err(e) => crate::send(&app, "update", json!({ "state": "error", "message": e.to_string().chars().take(200).collect::<String>() })),
                }
            }
            Ok(None) => {}
            Err(e) => crate::send(&app, "update", json!({ "state": "error", "message": e.to_string().chars().take(200).collect::<String>() })),
        }
        return json!({ "self": true });
    }
    // Fallback: ask GitHub for the newest release and compare versions
    let repo = repo();
    if repo.is_empty() { return json!({ "self": false }); }
    let r = crate::http::client().get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .header("Accept", "application/vnd.github+json").send().await;
    if let Ok(r) = r {
        if let Some(rel) = r.text().await.ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
            let latest = rel["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
            if !latest.is_empty() && newer(&latest, &app.package_info().version.to_string()) {
                crate::send(&app, "update", json!({ "state": "manual", "version": latest, "url": rel["html_url"] }));
            }
        }
    }
    json!({ "self": false })
}

/// Installs a downloaded update. `restart` is false when the app is closing anyway.
pub fn install(app: &AppHandle, restart: bool) {
    use tauri::Manager;
    let pending = app.state::<Pending>().0.lock().unwrap().take();
    if let Some((u, bytes)) = pending {
        if u.install(bytes).is_ok() && restart { app.restart(); }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions() {
        assert!(super::newer("0.2.1", "0.2.0"));
        assert!(super::newer("1.0", "0.9.9"));
        assert!(!super::newer("0.2.0", "0.2.0"));
        assert!(!super::newer("0.1.9", "0.2.0"));
    }
}
