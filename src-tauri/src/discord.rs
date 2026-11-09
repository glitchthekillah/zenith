// "Watching ..." / "Reading ..." on the user's Discord profile, through Discord's local
// RPC pipe. Needs an application ID in package.json -> zenith.discordClientId.
// One background thread: write a command, read its answer. Reconnects every 30 s.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

static TX: OnceLock<Mutex<Sender<Option<Value>>>> = OnceLock::new();

fn client_id() -> String {
    let pkg: Value = serde_json::from_str(include_str!("../../package.json")).unwrap_or(Value::Null);
    pkg["zenith"]["discordClientId"].as_str().unwrap_or("").to_string()
}

pub fn frame(op: i32, data: &Value) -> Vec<u8> {
    let body = data.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as i32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

fn read_frame(s: &mut impl Read) -> std::io::Result<(i32, Vec<u8>)> {
    let mut head = [0u8; 8];
    s.read_exact(&mut head)?;
    let op = i32::from_le_bytes(head[0..4].try_into().unwrap());
    let len = i32::from_le_bytes(head[4..8].try_into().unwrap()).clamp(0, 1 << 20) as usize;
    let mut body = vec![0; len];
    s.read_exact(&mut body)?;
    Ok((op, body))
}

trait Pipe: Read + Write + Send {}
impl<T: Read + Write + Send> Pipe for T {}

#[cfg(windows)]
fn connect() -> Option<Box<dyn Pipe>> {
    (0..10).find_map(|i| {
        std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\?\pipe\discord-ipc-{i}")).ok().map(|f| Box::new(f) as Box<dyn Pipe>)
    })
}

#[cfg(unix)]
fn connect() -> Option<Box<dyn Pipe>> {
    let env = |k: &str| std::env::var(k).ok();
    let base = env("XDG_RUNTIME_DIR").or(env("TMPDIR")).or(env("TMP")).unwrap_or_else(|| "/tmp".into());
    let dirs = [base.clone(), format!("{base}/app/com.discordapp.Discord"), format!("{base}/snap.discord"), format!("{base}/.flatpak/com.discordapp.Discord/xdg-run"), "/tmp".into()];
    for d in dirs {
        for i in 0..10 {
            if let Ok(s) = std::os::unix::net::UnixStream::connect(format!("{d}/discord-ipc-{i}")) {
                let _ = s.set_read_timeout(Some(Duration::from_secs(10)));
                return Some(Box::new(s));
            }
        }
    }
    None
}

/// activity from the page: { type, details, state, start, end, image, text } or null
pub fn shape(a: &Value) -> Option<Value> {
    if a.is_null() { return None; }
    let s = |k: &str| a[k].as_str().map(|v| v.chars().take(120).collect::<String>()).filter(|v| !v.is_empty());
    let image = a["image"].as_str().filter(|i| i.starts_with("https://")).unwrap_or("zenith");
    let mut out = json!({
        "type": if a["type"] == "reading" { 0 } else { 3 },
        "assets": { "large_image": image, "large_text": s("text").unwrap_or_else(|| "Zenith".into()) },
        "instance": false,
    });
    if let Some(d) = s("details") { out["details"] = d.into(); }
    if let Some(d) = s("state") { out["state"] = d.into(); }
    if let Some(start) = a["start"].as_f64().filter(|v| *v > 0.0) {
        out["timestamps"] = json!({ "start": start.floor() as i64 });
        if let Some(end) = a["end"].as_f64().filter(|v| *v > 0.0) { out["timestamps"]["end"] = json!(end.floor() as i64); }
    }
    Some(out)
}

pub fn start() {
    let id = client_id();
    if id.is_empty() { return; }
    let (tx, rx) = channel::<Option<Value>>();
    let _ = TX.set(Mutex::new(tx));
    std::thread::spawn(move || {
        let mut wanted: Option<Value> = None;
        let mut nonce = 0u64;
        loop {
            if let Some(mut s) = connect() {
                let hello = s.write_all(&frame(0, &json!({ "v": 1, "client_id": id }))).and_then(|_| read_frame(&mut s));
                if matches!(hello, Ok((1, _))) {
                    // Connected: send the current activity, then every change
                    let mut send = |s: &mut Box<dyn Pipe>, a: &Option<Value>| -> bool {
                        nonce += 1;
                        let mut cmd = json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id() }, "nonce": nonce.to_string() });
                        if let Some(a) = a { cmd["args"]["activity"] = a.clone(); } // left out = clear
                        s.write_all(&frame(1, &cmd)).and_then(|_| read_frame(s)).is_ok()
                    };
                    let mut alive = send(&mut s, &wanted);
                    while alive {
                        match rx.recv() {
                            Ok(a) => { wanted = a; alive = send(&mut s, &wanted); }
                            Err(_) => return,
                        }
                    }
                }
            }
            // Not connected: keep the newest wish, try again in 30 s
            let until = std::time::Instant::now() + Duration::from_secs(30);
            loop {
                let left = until.saturating_duration_since(std::time::Instant::now());
                if left.is_zero() { break; }
                match rx.recv_timeout(left) {
                    Ok(a) => wanted = a,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });
}

pub fn set(a: Value) -> bool {
    match TX.get() { Some(tx) => tx.lock().unwrap().send(shape(&a)).is_ok(), None => false }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frame_layout() {
        let f = frame(1, &json!({"a":1}));
        assert_eq!(&f[0..4], &1i32.to_le_bytes());
        assert_eq!(&f[4..8], &7i32.to_le_bytes());
        assert_eq!(&f[8..], br#"{"a":1}"#);
        let (op, body) = read_frame(&mut &f[..]).unwrap();
        assert_eq!((op, body.len()), (1, 7));
    }
    #[test]
    fn activity_shape() {
        assert!(shape(&Value::Null).is_none());
        let a = shape(&json!({"type":"reading","details":"x".repeat(200),"start":10.7,"image":"http://no"})).unwrap();
        assert_eq!(a["type"], 0);
        assert_eq!(a["details"].as_str().unwrap().len(), 120);
        assert_eq!(a["timestamps"]["start"], 10);
        assert_eq!(a["assets"]["large_image"], "zenith");
        assert!(a.get("state").is_none());
    }
}
