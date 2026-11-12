// Zenith desktop app (Tauri). The interface lives in ../app and runs exactly like the
// web version. This adds what a browser can't do: requests without CORS limits, an
// always-on-top mini player, media keys, downloads, Discord status and updates.
mod audio;
mod discord;
mod download;
mod http;
mod migrate;
mod secure;
mod update;
mod weblogin;
mod window;
#[cfg(target_os = "linux")]
mod linux_renderer;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub fn send(app: &AppHandle, channel: &str, data: Value) {
    let _ = app.emit_to("main", "zenith", json!({ "channel": channel, "data": data }));
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let t: String = title.chars().take(80).collect();
    let b: String = body.chars().take(200).collect();
    let _ = app.notification().builder().title(t).body(b).show();
}

// ── Commands the page can call (see app/js/desktop.js) ──────────────────
#[tauri::command]
async fn http(url: String, opts: Option<http::Opts>) -> Result<http::Resp, String> { http::request(&url, opts.unwrap_or_default()).await }
#[tauri::command]
fn http_forget(origin: Option<String>) { http::forget(origin) }
#[tauri::command]
fn info(app: AppHandle) -> Value {
    let os = if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" };
    json!({ "version": app.package_info().version.to_string(), "platform": os, "selfUpdate": update::can_self_update(), "repo": update::repo() })
}
#[tauri::command]
fn win(app: AppHandle, action: String, arg: Option<Value>) -> Value { window::action(&app, &action, arg) }
#[tauri::command]
fn open(app: AppHandle, url: String) {
    use tauri_plugin_opener::OpenerExt;
    if url.starts_with("https://") || url.starts_with("http://") { let _ = app.opener().open_url(url, None::<&str>); }
}
#[tauri::command]
fn show_file(app: AppHandle, file: Option<String>) {
    use tauri_plugin_opener::OpenerExt;
    if let Some(f) = file.filter(|f| std::path::Path::new(f).exists()) { let _ = app.opener().reveal_item_in_dir(f); }
}
#[tauri::command]
fn download(app: AppHandle, job: download::Job) -> bool { tauri::async_runtime::spawn(download::run(app, job)); true }
#[tauri::command]
fn download_cancel(id: String) { download::cancel(&id) }
#[tauri::command]
fn notify_cmd(app: AppHandle, title: String, body: Option<String>) { notify(&app, &title, body.as_deref().unwrap_or("")) }
#[tauri::command]
async fn update_check(app: AppHandle) -> Value { update::check(app).await }
#[tauri::command]
fn update_install(app: AppHandle) { update::install(&app, true) }
#[tauri::command]
fn discord_set(activity: Option<Value>) -> bool { discord::set(activity.unwrap_or(Value::Null)) }
#[tauri::command]
async fn web_login(app: AppHandle, url: String) -> Option<Value> { weblogin::run(app, url).await }
#[tauri::command]
fn migrated(app: AppHandle) { migrate::done(&app) }

#[tauri::command]
async fn audio_open(state: tauri::State<'_, audio::Audio>, rate: u32) -> Result<u64, String> {
    let ticket = audio::reserve(&state);
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || audio::open_reserved(&state, rate, ticket)).await.map_err(|_| "Windows audio output worker failed".to_string())?
}
#[tauri::command]
fn audio_write(state: tauri::State<'_, audio::Audio>, id: u64, generation: u64, samples: Vec<i16>) -> bool { audio::write(&state, id, generation, samples) }
#[tauri::command]
fn audio_flush(state: tauri::State<'_, audio::Audio>, id: u64, generation: u64) { audio::flush(&state, id, generation) }
#[tauri::command]
fn audio_close(state: tauri::State<'_, audio::Audio>, id: u64) { audio::close(&state, id) }

fn is_app_url(u: &url::Url) -> bool {
    // `npm start` (tauri dev) serves the app from a local dev server instead
    let dev = cfg!(debug_assertions) && u.scheme() == "http" && matches!(u.host_str(), Some("localhost") | Some("127.0.0.1"));
    dev || matches!(u.scheme(), "tauri" | "asset" | "about" | "blob" | "data") || u.host_str() == Some("tauri.localhost")
}

fn create_main(app: &AppHandle) -> tauri::Result<()> {
    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Zenith")
        .inner_size(1320.0, 840.0)
        .min_inner_size(320.0, 180.0)
        .decorations(false) // the app draws its own title bar (same on Windows and Linux)
        .visible(false)
        .background_color(tauri::window::Color(0x15, 0x15, 0x15, 0xff))
        .initialization_script(&migrate::script(app))
        .on_navigation({
            let app = app.clone();
            move |u| {
                if is_app_url(u) { return true; }
                // Links to other sites open in the normal browser
                if u.scheme() == "http" || u.scheme() == "https" {
                    use tauri_plugin_opener::OpenerExt;
                    let _ = app.opener().open_url(u.as_str(), None::<&str>);
                }
                false
            }
        })
        .on_page_load(|w, p| { if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) { let _ = w.show(); } });
    #[cfg(windows)]
    {
        // Same switches the Electron app used: HEVC, choosing audio tracks, use the GPU, autoplay next episode.
        // Tauri's own defaults are kept at the front.
        b = b.additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=PlatformHEVCDecoderSupport --enable-blink-features=AudioVideoTracks --ignore-gpu-blocklist --autoplay-policy=no-user-gesture-required");
    }
    let w = b.build()?;
    window::restore(app, &w);
    let app2 = app.clone();
    w.on_window_event(move |e| match e {
        WindowEvent::Resized(_) => { window::changed(&app2); save_soon(&app2); }
        WindowEvent::Moved(_) => save_soon(&app2),
        WindowEvent::CloseRequested { .. } => window::save(&app2),
        _ => {}
    });
    Ok(())
}

fn save_soon(app: &AppHandle) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static GEN: AtomicU64 = AtomicU64::new(0);
    let g = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        if GEN.load(Ordering::SeqCst) == g { window::save(&app); }
    });
}

fn media_keys(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};
    for (code, action) in [(Code::MediaPlayPause, "toggle"), (Code::MediaTrackNext, "next"), (Code::MediaTrackPrevious, "previous"), (Code::MediaStop, "stop")] {
        let _ = app.global_shortcut().on_shortcut(Shortcut::new(None, code), move |app, _, e| {
            if e.state() == ShortcutState::Pressed { send(app, "media-key", json!(action)); }
        });
    }
}

// WebKit's 100 KB download-buffer default can deadlock interleaved MKV streams
// after their first frames. Set the bounded window before WebKit/GStreamer starts.
#[cfg(target_os = "linux")]
fn configure_media_runtime() -> (u32, u32, u32) {
    const KEY: &str = "WPE_SHELL_MEDIA_DISK_CACHE_SIZE_BYTES";
    if std::env::var_os(KEY).is_none() {
        std::env::set_var(KEY, "33554432");
    }
    linux_renderer::configure()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        let webkit_version = configure_media_runtime();
        // Packaging checks exercise the shipped binary's defaults without a GUI.
        if std::env::args_os().any(|arg| arg == "--zenith-media-runtime") {
            println!("{}", json!({"version": env!("CARGO_PKG_VERSION"), "mediaBufferBytes": std::env::var("WPE_SHELL_MEDIA_DISK_CACHE_SIZE_BYTES").ok().and_then(|v| v.parse::<u64>().ok()), "webkitVersion": [webkit_version.0,webkit_version.1,webkit_version.2], "rendererOverrides": {"disableDmaBuf": std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").ok(), "forceSharedMemory": std::env::var("WEBKIT_DMABUF_RENDERER_FORCE_SHM").ok()}}));
            return;
        }
    }
    let builder = tauri::Builder::default();
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_video::init());
    let app = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { let _ = window::action(app, "focus", None); }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(window::WinState(Default::default()))
        .manage(update::Pending::default())
        .manage(audio::Audio::default())
        .invoke_handler(tauri::generate_handler![audio_open, audio_write, audio_flush, audio_close, http, http_forget, info, win, open, show_file, download, download_cancel, notify_cmd, update_check, update_install, discord_set, web_login, migrated])
        .setup(|app| {
            let h = app.handle().clone();
            http::load(&h);
            create_main(&h)?;
            media_keys(&h);
            discord::start();
            // Check for updates shortly after start, then every 6 hours
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                loop {
                    update::check(h.clone()).await;
                    tokio::time::sleep(std::time::Duration::from_secs(6 * 60 * 60)).await;
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Zenith");
    app.run(|app, e| {
        // A downloaded update installs when Zenith closes, like before
        if let RunEvent::Exit = e { update::install(app, false); }
    });
}
