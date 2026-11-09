// Downloads for offline viewing, saved in Downloads/Zenith
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

#[derive(Deserialize)]
pub struct Job { pub url: String, pub name: Option<String>, pub id: String }

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static M: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

pub fn safe_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let collapsed = cleaned.split(' ').filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
    let cut: String = collapsed.trim().chars().take(150).collect();
    let cut = cut.trim().trim_end_matches('.').to_string();
    if cut.is_empty() { "video".into() } else { cut }
}

pub fn cancel(id: &str) { if let Some(f) = running().lock().unwrap().get(id) { f.store(true, Ordering::SeqCst); } }

pub async fn run(app: AppHandle, job: Job) {
    let stop = Arc::new(AtomicBool::new(false));
    running().lock().unwrap().insert(job.id.clone(), stop.clone());
    let id = job.id.clone();
    let result = fetch(&app, &job, &stop).await;
    running().lock().unwrap().remove(&id);
    match result {
        Ok((file, got)) => {
            crate::send(&app, "download", json!({ "id": id, "got": got, "total": got, "done": true, "file": file }));
            crate::notify(&app, "Download finished", &safe_name(job.name.as_deref().unwrap_or("video")));
        }
        Err(e) => crate::send(&app, "download", json!({ "id": id, "error": e })),
    }
}

async fn fetch(app: &AppHandle, job: &Job, stop: &AtomicBool) -> Result<(String, u64), String> {
    let dir = app.path().download_dir().map_err(|_| "Couldn't find your Downloads folder.".to_string())?.join("Zenith");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let file = dir.join(safe_name(job.name.as_deref().unwrap_or("video")));
    let part = file.with_file_name(format!("{}.part", file.file_name().unwrap().to_string_lossy()));
    let res = crate::http::client().get(&job.url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() { return Err(format!("The server answered {}.", res.status().as_u16())); }
    let total = res.content_length().unwrap_or(0);
    let mut out = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    let (mut got, mut last) = (0u64, std::time::Instant::now());
    let mut res = res;
    let outcome: Result<(), String> = async {
        loop {
            if stop.load(Ordering::SeqCst) { return Err("Cancelled".into()); }
            let chunk = match res.chunk().await { Ok(Some(c)) => c, Ok(None) => break, Err(e) => return Err(e.to_string()) };
            out.write_all(&chunk).await.map_err(|e| e.to_string())?;
            got += chunk.len() as u64;
            if last.elapsed().as_millis() > 400 {
                last = std::time::Instant::now();
                crate::send(app, "download", json!({ "id": job.id, "got": got, "total": total }));
            }
        }
        out.flush().await.map_err(|e| e.to_string())
    }.await;
    drop(out);
    if let Err(e) = outcome { let _ = tokio::fs::remove_file(&part).await; return Err(e); }
    tokio::fs::rename(&part, &file).await.map_err(|e| e.to_string())?;
    Ok((file.to_string_lossy().into_owned(), got))
}

#[cfg(test)]
mod tests {
    #[test]
    fn names() {
        assert_eq!(super::safe_name("a/b:c?.mkv"), "a b c .mkv");
        assert_eq!(super::safe_name("  "), "video");
        assert_eq!(super::safe_name("..."), "video");
        assert_eq!(super::safe_name(&"x".repeat(300)).len(), 150);
    }
}
