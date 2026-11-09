// The main window: saved size and place, our own title bar buttons, the always-on-top
// mini player, and telling the page when maximize or full screen changes.
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Rect { pub x: i32, pub y: i32, pub width: u32, pub height: u32 }

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Saved {
    #[serde(default)] pub bounds: Option<Rect>,
    #[serde(default)] pub maximized: bool,
    #[serde(default)] pub mini: bool,
    #[serde(default, rename = "miniBounds")] pub mini_bounds: Option<Rect>,
}

#[derive(Default)]
pub struct Live { pub normal: Option<Rect>, pub pinned: bool, pub last: (bool, bool) }
pub struct WinState(pub Mutex<Live>);

fn path(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_data_dir().ok().map(|d| d.join("window.json")) }
pub fn read(app: &AppHandle) -> Saved {
    path(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn write(app: &AppHandle, s: &Saved) {
    if let Some(p) = path(app) {
        if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); }
        let _ = std::fs::write(p, serde_json::to_vec(s).unwrap_or_default());
    }
}

fn bounds(w: &WebviewWindow) -> Option<Rect> {
    let p = w.outer_position().ok()?;
    let s = w.outer_size().ok()?;
    Some(Rect { x: p.x, y: p.y, width: s.width, height: s.height })
}
fn put(w: &WebviewWindow, r: Rect) {
    let _ = w.set_size(PhysicalSize::new(r.width, r.height));
    let _ = w.set_position(PhysicalPosition::new(r.x, r.y));
}

/// A rectangle that is actually on one of the screens (same rule as before)
pub fn on_screen(app: &AppHandle, b: Option<Rect>) -> Option<Rect> {
    let b = b?;
    let mons = app.available_monitors().ok()?;
    mons.iter().any(|m| {
        let (p, s) = (m.work_area().position, m.work_area().size);
        b.x >= p.x - 50 && b.y >= p.y - 50 && b.x < p.x + s.width as i32 - 80 && b.y < p.y + s.height as i32 - 80
    }).then_some(b)
}

pub fn restore(app: &AppHandle, w: &WebviewWindow) {
    let mut s = read(app);
    if let Some(b) = on_screen(app, s.bounds) { put(w, b); }
    if s.maximized { let _ = w.maximize(); }
    if s.mini { s.mini = false; write(app, &s); } // always start as the normal window
}

pub fn save(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    let mut s = read(app);
    let max = w.is_maximized().unwrap_or(false);
    if !s.mini && !max && !w.is_fullscreen().unwrap_or(false) && !w.is_minimized().unwrap_or(false) { s.bounds = bounds(&w).or(s.bounds); }
    s.maximized = max;
    write(app, &s);
}

pub fn emit(app: &AppHandle, data: serde_json::Value) { crate::send(app, "window", data); }

/// Called on resize: tell the page when maximize or full screen changed
pub fn changed(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    let now = (w.is_maximized().unwrap_or(false), w.is_fullscreen().unwrap_or(false));
    let st = app.state::<WinState>();
    let mut live = st.0.lock().unwrap();
    if live.last.0 != now.0 { emit(app, json!({ "maximized": now.0 })); }
    if live.last.1 != now.1 { emit(app, json!({ "fullscreen": now.1 })); }
    live.last = now;
}

pub fn set_mini(app: &AppHandle, on: bool) {
    let Some(w) = app.get_webview_window("main") else { return };
    let mut s = read(app);
    let st = app.state::<WinState>();
    let mut live = st.0.lock().unwrap();
    let scale = w.scale_factor().unwrap_or(1.0);
    let px = |v: f64| (v * scale).round() as u32;
    if on {
        if w.is_fullscreen().unwrap_or(false) { let _ = w.set_fullscreen(false); }
        if w.is_maximized().unwrap_or(false) { let _ = w.unmaximize(); }
        live.normal = bounds(&w);
        let _ = w.set_min_size(Some(PhysicalSize::new(px(240.0), px(135.0))));
        let target = on_screen(app, s.mini_bounds).or_else(|| {
            let m = w.current_monitor().ok().flatten()?;
            let (p, sz) = (m.work_area().position, m.work_area().size);
            let (ww, hh, pad) = (px(480.0), px(270.0), px(24.0) as i32);
            Some(Rect { x: p.x + sz.width as i32 - ww as i32 - pad, y: p.y + sz.height as i32 - hh as i32 - pad, width: ww, height: hh })
        });
        if let Some(t) = target { put(&w, t); }
        let _ = w.set_always_on_top(true);
        let _ = w.set_visible_on_all_workspaces(true);
        s.mini = true;
    } else {
        s.mini_bounds = bounds(&w);
        let _ = w.set_always_on_top(live.pinned);
        let _ = w.set_visible_on_all_workspaces(false);
        let _ = w.set_min_size(Some(PhysicalSize::new(px(320.0), px(180.0))));
        let back = live.normal.or(s.bounds).unwrap_or(Rect { x: 100, y: 100, width: px(1320.0), height: px(840.0) });
        put(&w, back);
        s.mini = false;
    }
    write(app, &s);
    drop(live);
    emit(app, json!({ "mini": on }));
}

/// The page's window buttons: minimize, maximize, close, fullscreen, mini, pin, focus, state
pub fn action(app: &AppHandle, action: &str, arg: Option<serde_json::Value>) -> serde_json::Value {
    let Some(w) = app.get_webview_window("main") else { return serde_json::Value::Null };
    let flag = arg.as_ref().and_then(|v| v.as_bool());
    let mut asked_fs = None;
    match action {
        "minimize" => { let _ = w.minimize(); }
        "maximize" => { if w.is_maximized().unwrap_or(false) { let _ = w.unmaximize(); } else { let _ = w.maximize(); } }
        "close" => { save(app); let _ = w.close(); }
        "fullscreen" => { let on = flag.unwrap_or(!w.is_fullscreen().unwrap_or(false)); let _ = w.set_fullscreen(on); asked_fs = Some(on); }
        "mini" => { let on = flag.unwrap_or(!read(app).mini); set_mini(app, on); }
        "pin" => {
            let on = flag.unwrap_or(false);
            app.state::<WinState>().0.lock().unwrap().pinned = on;
            let _ = w.set_always_on_top(on || read(app).mini);
        }
        "focus" => { let _ = w.unminimize(); let _ = w.set_focus(); }
        _ => {}
    }
    let pinned = app.state::<WinState>().0.lock().unwrap().pinned;
    // fullscreen is reported as asked: the window manager may apply it a moment later
    let fs = asked_fs.unwrap_or_else(|| w.is_fullscreen().unwrap_or(false));
    json!({ "maximized": w.is_maximized().unwrap_or(false), "fullscreen": fs, "mini": read(app).mini, "pinned": pinned })
}
