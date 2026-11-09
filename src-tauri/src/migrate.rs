// First launch after the Electron version: bring over its settings and sign-ins.
// Electron kept them in Chromium's local storage (a LevelDB folder). We read a copy,
// pick the keys for app://zenith, and the page copies them into its own storage.
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PREFIX: &[u8] = b"_app://zenith\x00";

fn electron_dirs() -> Vec<PathBuf> {
    let mut bases = Vec::new();
    #[cfg(windows)]
    if let Some(a) = std::env::var_os("APPDATA") { bases.push(PathBuf::from(a)); }
    #[cfg(unix)]
    {
        if let Some(x) = std::env::var_os("XDG_CONFIG_HOME") { bases.push(PathBuf::from(x)); }
        if let Some(h) = std::env::var_os("HOME") { bases.push(PathBuf::from(h).join(".config")); }
    }
    bases.into_iter().flat_map(|b| ["Zenith", "zenith"].map(|n| b.join(n).join("Local Storage").join("leveldb"))).filter(|p| p.is_dir()).collect()
}

/// Chromium stores keys and values with a one-byte format mark: 1 = Latin-1, 0 = UTF-16LE
pub fn decode(b: &[u8]) -> Option<String> {
    match b.split_first()? {
        (1, rest) => Some(rest.iter().map(|&c| c as char).collect()),
        (0, rest) if rest.len() % 2 == 0 => String::from_utf16(&rest.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>()).ok(),
        _ => None,
    }
}

pub fn read_dir(dir: &Path) -> Option<Map<String, Value>> {
    // Work on a copy so the old app's files are never touched
    let tmp = std::env::temp_dir().join(format!("zenith-migrate-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).ok()?;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name();
        if name == "LOCK" || !e.path().is_file() { continue; }
        std::fs::copy(e.path(), tmp.join(&name)).ok()?;
    }
    let mut opts = rusty_leveldb::Options::default();
    opts.create_if_missing = false;
    let out = (|| {
        let mut db = rusty_leveldb::DB::open(&tmp, opts).ok()?;
        let mut it = db.new_iter().ok()?;
        let mut out = Map::new();
        use rusty_leveldb::LdbIterator;
        while let Some((k, v)) = it.next() {
            let Some(key) = k.strip_prefix(PREFIX) else { continue };
            if let (Some(k), Some(v)) = (decode(key), decode(&v)) { out.insert(k, Value::String(v)); }
        }
        Some(out)
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    out.filter(|m| !m.is_empty())
}

fn marker(app: &AppHandle) -> Option<PathBuf> { app.path().app_data_dir().ok().map(|d| d.join("migrated-from-electron")) }

/// A script that hands the old settings to the page, or "" when there is nothing to do
pub fn script(app: &AppHandle) -> String {
    let Some(m) = marker(app) else { return String::new() };
    if m.exists() { return String::new(); }
    let found = electron_dirs().iter().find_map(|d| read_dir(d));
    match found {
        Some(map) => format!("window.__zenithMigrate={};", Value::Object(map)),
        None => { done(app); String::new() }
    }
}

pub fn done(app: &AppHandle) {
    // `npm start` keeps its own storage, so it must not use up the move for the installed app
    if cfg!(debug_assertions) { return; }
    if let Some(m) = marker(app) {
        if let Some(d) = m.parent() { let _ = std::fs::create_dir_all(d); }
        let _ = std::fs::write(m, b"1");
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_both_formats() {
        assert_eq!(super::decode(b"\x01zenith").unwrap(), "zenith");
        assert_eq!(super::decode(&[0, b'h', 0, 0xe9, 0]).unwrap(), "h\u{e9}");
        assert!(super::decode(&[2, 1]).is_none());
    }
    #[test]
    fn reads_a_real_leveldb() {
        // Made by tests with the real LevelDB library; skipped when the folder isn't given
        let Ok(dir) = std::env::var("ZENITH_TEST_LDB") else { return };
        let m = super::read_dir(std::path::Path::new(&dir)).expect("read");
        assert_eq!(m.len(), 3);
        assert!(m["zenith"].as_str().unwrap().contains("jf.test"));
        assert_eq!(m["zenith-meta"], "caf\u{e9} \u{4e2d}");
        assert_eq!(m["zenith-device"], "abc123");
    }
}
