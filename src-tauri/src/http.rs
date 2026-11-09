// Requests to the user's servers, made here so the servers don't need to allow
// cross-site requests. Cookies (Seerr and the ask site sign in with a cookie) are kept
// per server and never shown to the page. Same behavior as shared/http.js.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const MAX_BODY: usize = 30 * 1024 * 1024;
type Jar = BTreeMap<String, String>;

static JARS: OnceLock<Mutex<HashMap<String, Jar>>> = OnceLock::new();
static SAVE_GEN: AtomicU64 = AtomicU64::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();

fn jars() -> &'static Mutex<HashMap<String, Jar>> {
    JARS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Zenith/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("http client")
    })
}

#[derive(Deserialize, Default)]
pub struct Opts {
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout: Option<u64>,
}

#[derive(Serialize)]
pub struct Resp {
    pub ok: bool,
    pub status: u16,
    pub headers: HashMap<&'static str, String>,
    pub body: String,
    pub base64: bool,
}

/// Reads Set-Cookie lines into the jar. Returns true when the jar changed.
pub fn keep_cookies<'a>(jar: &mut Jar, lines: impl Iterator<Item = &'a str>) -> bool {
    let before = jar.clone();
    for line in lines {
        let mut parts = line.split(';');
        let pair = parts.next().unwrap_or("");
        let Some(i) = pair.find('=') else { continue };
        if i < 1 { continue; }
        let (name, value) = (pair[..i].trim().to_string(), pair[i + 1..].trim().to_string());
        let expired = parts.any(|a| {
            let a = a.trim().to_ascii_lowercase();
            if let Some(v) = a.strip_prefix("max-age") {
                let v = v.trim_start().trim_start_matches('=').trim();
                return v.parse::<i64>().map(|n| n <= 0).unwrap_or(false);
            }
            if let Some(v) = a.strip_prefix("expires=") {
                return httpdate_past(v);
            }
            false
        });
        if expired || value.is_empty() { jar.remove(&name); } else { jar.insert(name, value); }
    }
    *jar != before
}

// "Thu, 01 Jan 1970 00:00:00 GMT" in the past? Only the year is needed for the usual "delete" dates.
fn httpdate_past(v: &str) -> bool {
    v.split_whitespace().find_map(|w| w.parse::<i32>().ok().filter(|y| *y > 1900)).map(|y| y < 2000).unwrap_or(false)
}

fn friendly(e: &reqwest::Error) -> String {
    if e.is_timeout() { return "The server took too long to answer.".into(); }
    let mut chain = format!("{e}");
    let mut src = std::error::Error::source(e);
    while let Some(s) = src { chain.push_str(&format!(" | {s}")); src = s.source(); }
    let c = chain.to_ascii_lowercase();
    if c.contains("dns") || c.contains("failed to lookup") || c.contains("no such host") || c.contains("name or service not known") {
        "Couldn't find that server. Check the address.".into()
    } else if c.contains("refused") {
        "The server refused the connection. Is it running?".into()
    } else if c.contains("certificate") || c.contains("unknownissuer") || c.contains("invalid peer") {
        "The server's HTTPS certificate isn't valid.".into()
    } else {
        "Network error.".into()
    }
}

pub async fn request(url: &str, opts: Opts) -> Result<Resp, String> {
    let u = url::Url::parse(url).map_err(|_| "That address isn't valid.".to_string())?;
    if u.scheme() != "http" && u.scheme() != "https" { return Err("Only http and https addresses work.".into()); }
    let origin = u.origin().ascii_serialization();
    let method = reqwest::Method::from_bytes(opts.method.as_deref().unwrap_or("GET").as_bytes()).map_err(|_| "Bad method.".to_string())?;
    let mut req = client().request(method, u.clone()).timeout(Duration::from_millis(opts.timeout.unwrap_or(30_000)));
    for (k, v) in opts.headers.unwrap_or_default() {
        if k.eq_ignore_ascii_case("cookie") { continue; }
        req = req.header(k, v);
    }
    let cookie = {
        let j = jars().lock().unwrap();
        j.get(&origin).filter(|m| !m.is_empty()).map(|m| m.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; "))
    };
    if let Some(c) = cookie { req = req.header("Cookie", c); }
    if let Some(b) = opts.body { req = req.body(b); }
    let res = req.send().await.map_err(|e| friendly(&e))?;
    let changed = {
        let mut j = jars().lock().unwrap();
        let jar = j.entry(origin).or_default();
        keep_cookies(jar, res.headers().get_all("set-cookie").iter().filter_map(|v| v.to_str().ok()))
    };
    if changed { schedule_save(); }
    let status = res.status();
    let ctype = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let location = res.headers().get("location").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if res.content_length().unwrap_or(0) as usize > MAX_BODY { return Err("That response is too large.".into()); }
    let mut buf = Vec::new();
    let mut stream = res;
    while let Some(chunk) = stream.chunk().await.map_err(|e| friendly(&e))? {
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_BODY { return Err("That response is too large.".into()); }
    }
    let text = ctype.is_empty() || ["json", "text", "xml", "javascript", "html"].iter().any(|t| ctype.contains(t));
    use base64::Engine;
    let body = if text { String::from_utf8_lossy(&buf).into_owned() } else { base64::engine::general_purpose::STANDARD.encode(&buf) };
    let mut headers = HashMap::new();
    headers.insert("content-type", ctype);
    headers.insert("location", location);
    Ok(Resp { ok: status.is_success(), status: status.as_u16(), headers, body, base64: !text })
}

pub fn forget(origin: Option<String>) {
    let mut j = jars().lock().unwrap();
    match origin { Some(o) => { j.remove(&o); } None => j.clear() }
    drop(j);
    schedule_save();
}

pub fn import_cookies(origin: &str, cookies: Vec<(String, String)>) {
    let mut j = jars().lock().unwrap();
    let jar = j.entry(origin.to_string()).or_default();
    for (k, v) in cookies { jar.insert(k, v); }
    drop(j);
    schedule_save();
}

// ── Saved between launches (same file shape as the Electron app: { desktop: { origin: { name: value } } })
fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("sessions.bin"))
}

pub fn load(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let Some(path) = file(app) else { return };
    let Ok(raw) = std::fs::read(&path) else { return };
    let Some(text) = crate::secure::unprotect(&raw) else { return };
    let Ok(data) = serde_json::from_slice::<HashMap<String, HashMap<String, Jar>>>(&text) else { return };
    if let Some(d) = data.get("desktop") { *jars().lock().unwrap() = d.clone(); }
}

fn schedule_save() {
    let gen = SAVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if SAVE_GEN.load(Ordering::SeqCst) != gen { return; }
        let Some(app) = APP.get() else { return };
        let Some(path) = file(app) else { return };
        let data = { let j = jars().lock().unwrap(); serde_json::json!({ "desktop": *j }) };
        let bytes = crate::secure::protect(data.to_string().as_bytes());
        if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            crate::secure::private(&tmp);
            let _ = std::fs::rename(&tmp, &path);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cookies_set_replace_and_delete() {
        let mut jar = Jar::new();
        assert!(keep_cookies(&mut jar, ["a=1; Path=/; HttpOnly", "b=2"].into_iter()));
        assert_eq!(jar.get("a").unwrap(), "1");
        assert!(!keep_cookies(&mut jar, ["a=1"].into_iter()));
        assert!(keep_cookies(&mut jar, ["a=; Max-Age=0", "b=x; expires=Thu, 01 Jan 1970 00:00:00 GMT"].into_iter()));
        assert!(jar.is_empty());
        keep_cookies(&mut jar, ["=bad", "c=3; Max-Age=3600; expires=Fri, 01 Jan 2100 00:00:00 GMT"].into_iter());
        assert_eq!(jar.len(), 1);
    }
}
