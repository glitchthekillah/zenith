// Sign in through a server's own website (single sign-on, like Kavita's "Jellyfin" button).
// Opens the site in its own window with its own storage and no access to the app, waits
// until the site has saved the signed-in user, then hands back only that sign-in.
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc;

const PROBE: &str = include_str!("../../shared/kavita-probe.js");
const RESULT_HOST: &str = "zenith-probe.invalid";

enum Msg { Found(String, String), Closed }

/// The script run inside the sign-in page. It reports back by navigating to a fake
/// address, which the window catches and cancels. The nonce stops other sites faking it.
pub fn wrapper(nonce: &str) -> String {
    format!(
        "(async()=>{{if(window.__zp)return;window.__zp=1;try{{const f=await ({PROBE})();if(f)location.href='https://{RESULT_HOST}/#{nonce}.'+encodeURIComponent(JSON.stringify(f));}}catch(e){{}}finally{{window.__zp=0}}}})()"
    )
}

/// Reads a result address back: returns the JSON if the nonce matches
pub fn parse_result(url: &url::Url, nonce: &str) -> Option<Value> {
    if url.host_str() != Some(RESULT_HOST) { return None; }
    let frag = url.fragment()?;
    let rest = frag.strip_prefix(nonce)?.strip_prefix('.')?;
    let text = percent_decode(rest);
    serde_json::from_str(&text).ok().filter(|v: &Value| v.is_object())
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("x"), 16) { out.push(v); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn nonce() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let mut x = (t as u64) ^ (std::process::id() as u64).rotate_left(32) ^ N.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed);
    let mut s = String::new();
    for _ in 0..4 { x ^= x << 13; x ^= x >> 7; x ^= x << 17; s.push_str(&format!("{x:016x}")); }
    s
}

pub async fn run(app: AppHandle, url: String) -> Option<Value> {
    let target = url::Url::parse(&url).ok()?;
    let origin = target.origin().ascii_serialization();
    let start = url::Url::parse(&format!("{origin}/login")).ok()?;
    let nonce = nonce();
    let (tx, mut rx) = mpsc::unbounded_channel::<Msg>();
    let label = format!("weblogin-{}", &nonce[..8]);
    let data = app.path().app_data_dir().ok()?.join("web-login");

    let (tx_nav, tx_close, n2, o2) = (tx.clone(), tx.clone(), nonce.clone(), origin.clone());
    let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(start))
        .title("Sign in")
        .inner_size(520.0, 760.0)
        .background_color(tauri::window::Color(0x15, 0x15, 0x15, 0xff))
        .data_directory(data)
        .on_navigation(move |u| {
            if u.host_str() == Some(RESULT_HOST) {
                if let Some(v) = parse_result(u, &n2) { let _ = tx_nav.send(Msg::Found(v.to_string(), o2.clone())); }
                return false;
            }
            u.scheme() == "https" || u.scheme() == "http" || u.scheme() == "about"
        });
    if let Some(main) = app.get_webview_window("main") { b = b.parent(&main).ok()?; }
    let w = b.build().ok()?;
    w.on_window_event(move |e| { if let tauri::WindowEvent::Destroyed = e { let _ = tx_close.send(Msg::Closed); } });

    let script = wrapper(&nonce);
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    let result = loop {
        tokio::select! {
            m = rx.recv() => match m {
                None | Some(Msg::Closed) => break None,
                Some(Msg::Found(json, from)) => {
                    let Ok(found) = serde_json::from_str::<Value>(&json) else { continue };
                    if from != origin { continue; }
                    if w.url().map(|u| u.origin().ascii_serialization() != origin).unwrap_or(true) { continue; }
                    if found["cookie"] == true {
                        // The account uses an HttpOnly cookie: take it, and check it really signs us in
                        let Ok(account_url) = url::Url::parse(&format!("{origin}/api/Account")) else { continue };
                        let Ok(list) = w.cookies_for_url(account_url) else { continue };
                        if list.is_empty() { continue; }
                        crate::http::import_cookies(&origin, list.iter().map(|c| (c.name().to_string(), c.value().to_string())).collect());
                        let Ok(r) = crate::http::request(&format!("{origin}/api/Account"), Default::default()).await else { continue };
                        if !r.ok { continue; }
                        let account: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
                        if account["username"] != found["username"] { continue; }
                    }
                    break Some(found);
                }
            },
            _ = tick.tick() => {
                if w.url().map(|u| u.origin().ascii_serialization() == origin).unwrap_or(false) { let _ = w.eval(&script); }
            }
        }
    };
    let _ = w.destroy();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn result_needs_the_right_nonce() {
        let good = url::Url::parse("https://zenith-probe.invalid/#abc.%7B%22username%22%3A%22glitch%22%7D").unwrap();
        assert_eq!(parse_result(&good, "abc").unwrap()["username"], "glitch");
        assert!(parse_result(&good, "abd").is_none());
        let other = url::Url::parse("https://evil.test/#abc.%7B%7D").unwrap();
        assert!(parse_result(&other, "abc").is_none());
        let not_obj = url::Url::parse("https://zenith-probe.invalid/#abc.1").unwrap();
        assert!(parse_result(&not_obj, "abc").is_none());
    }
    #[test]
    fn wrapper_contains_probe() {
        let s = wrapper("n1");
        assert!(s.contains("async function probe"));
        assert!(s.contains("#n1."));
    }
}
