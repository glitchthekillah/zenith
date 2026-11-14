//! Private-pipe handoff to the bundled Qt/libmpv playback window.
use std::{path::PathBuf, process::Stdio, sync::{Arc, Mutex}, time::Duration};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::Command, sync::mpsc};
use crate::qt_lifecycle::SessionSlot;

#[derive(Clone, Default)]
pub struct Players(Arc<Mutex<SessionSlot<mpsc::UnboundedSender<Value>>>>);

fn paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resources = app.path().resource_dir().map_err(|_| "Player resources are unavailable")?;
    let helper = resources.join("linux-player/run-player");
    let assets = resources.join("player-assets");
    if !helper.is_file() || !assets.join("qt-player.html").is_file() {
        return Err("The bundled Linux player is missing. Reinstall this Zenith package.".into());
    }
    Ok((helper, assets))
}

pub async fn open(app: AppHandle, players: Players, payload: Value) -> Result<Value, String> {
    if !payload.is_object() || !payload.get("item").is_some_and(Value::is_object)
        || !payload.get("settings").is_some_and(Value::is_object) {
        return Err("Invalid playback request".into());
    }
    let mut boot = serde_json::to_vec(&payload).map_err(|_| "Invalid playback request")?;
    if boot.len() > 4 * 1024 * 1024 { return Err("Playback request is too large".into()); }
    boot.push(b'\n');
    let (helper, assets) = paths(&app)?;
    let diagnostics = matches!(std::env::var("CI").as_deref(), Ok("true" | "1"))
        && std::env::var("ZENITH_QT_DIAGNOSTICS").as_deref() == Ok("1");
    let mut child = Command::new(helper).arg("--assets").arg(assets)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(if diagnostics { Stdio::inherit() } else { Stdio::null() })
        .kill_on_drop(true).spawn().map_err(|_| "The bundled Linux player could not start")?;
    let mut stdin = child.stdin.take().ok_or("The player connection could not open")?;
    tokio::time::timeout(Duration::from_secs(10), stdin.write_all(&boot)).await
        .map_err(|_| "The Linux player did not respond")?
        .map_err(|_| "The Linux player closed during startup")?;
    let stdout = child.stdout.take().ok_or("The player connection could not open")?;
    let (tx, mut rx) = mpsc::unbounded_channel();
    let (id, old) = players.0.lock().unwrap().claim(tx);
    if let Some(old) = old { let _ = old.send(json!({"type":"close"})); }
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let deadline = tokio::time::sleep(Duration::from_secs(35));
        tokio::pin!(deadline);
        let mut ready = false;
        let mut failed = false;
        let mut commands_open = true;
        let mut closing = false;
        let mut acknowledged = false;
        let mut playback = Value::Null;
        loop {
            tokio::select! {
                _ = &mut deadline, if !ready || closing => { failed = true; break; }
                command = rx.recv(), if commands_open => {
                    let command = match command {
                        Some(command) => command,
                        None => {
                            // Replacement drops the retired session's last
                            // sender. EOF on this internal command channel is
                            // not permission to tear down the child's stdin:
                            // its JS still needs to report stopped playback.
                            commands_open = false;
                            if closing { continue; }
                            json!({"type":"close"})
                        }
                    };
                    if command.get("type").and_then(Value::as_str) == Some("close") {
                        closing = true;
                        deadline.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(4));
                    }
                    let mut encoded = match serde_json::to_vec(&command) { Ok(value) => value, Err(_) => break };
                    encoded.push(b'\n');
                    if !matches!(tokio::time::timeout(Duration::from_secs(2), stdin.write_all(&encoded)).await, Ok(Ok(()))) { break; }
                }
                line = lines.next_line() => {
                    let line = match line { Ok(Some(line)) if line.len() <= 65536 => line, _ => break };
                    let event: Value = match serde_json::from_str(&line) { Ok(value) => value, Err(_) => continue };
                    match event.get("type").and_then(Value::as_str) {
                        Some("ready") => {
                            ready = true;
                            if players.0.lock().unwrap().current(id) {
                                if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
                            }
                        }
                        Some("discord") if players.0.lock().unwrap().current(id) => { crate::discord::set(event.get("data").cloned().unwrap_or(Value::Null)); }
                        Some("closed") => { acknowledged = true; playback = event.get("playback").filter(|value| value.is_object()).cloned().unwrap_or(Value::Null); break; }
                        Some("error") => { failed = true; break; }
                        _ => {}
                    }
                }
            }
        }
        drop(stdin);
        match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
            Ok(Ok(status)) if status.success() => {}
            _ => { failed = true; let _ = child.kill().await; }
        }
        failed |= !acknowledged;
        let owned = players.0.lock().unwrap().finish(id);
        if owned {
            crate::discord::set(Value::Null);
            if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        }
        crate::send(&app, "qt-player-closed", json!({"id":id,"playback":playback,
            "error": if failed || !ready { Some("The Linux playback window could not continue.") } else { None }}));
    });
    Ok(json!({"id":id}))
}

pub fn close(players: &Players, id: u64) {
    let state = players.0.lock().unwrap();
    if state.current(id) { if let Some(tx) = state.value() { let _ = tx.send(json!({"type":"close"})); } }
}
pub fn media_key(players: &Players, key: &str) {
    if let Some(tx) = players.0.lock().unwrap().value() { let _ = tx.send(json!({"type":"media-key","data":key})); }
}
pub fn shutdown(players: &Players) { if let Some(tx) = players.0.lock().unwrap().value() { let _ = tx.send(json!({"type":"close"})); } }
