//! Version-aware compatibility policy for transparent WebKitGTK video controls.
//! Based on the documented Tauri workaround and Handy's merged 2.54 correction:
//! https://v2.tauri.app/develop/debug/linux-graphics/
//! https://github.com/cjpais/Handy/pull/2360

const LEGACY: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
const SHARED: &str = "WEBKIT_DMABUF_RENDERER_FORCE_SHM";

#[cfg(target_os = "linux")]
#[link(name = "X11")]
unsafe extern "C" {
    fn XInitThreads() -> std::ffi::c_int;
}

#[cfg(target_os = "linux")]
pub fn x11_threads_initialized() -> bool {
    static INITIALIZED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *INITIALIZED.get_or_init(|| unsafe { XInitThreads() != 0 })
}

fn default_override(version: (u32, u32), explicitly_configured: bool) -> Option<&'static str> {
    if explicitly_configured { return None; }
    // The blanket legacy override regressed transparent overlay repainting
    // and UI responsiveness. Older WebKit keeps its accelerated default.
    if version >= (2, 54) { Some(SHARED) } else { None }
}

#[cfg(target_os = "linux")]
pub fn configure() -> (u32, u32, u32) {
    // GStreamer GL and GTK can both access Xlib. Its thread support MUST be
    // initialized before GTK/WebKit creates a display, including on hosts
    // which choose XWayland. Calling it from a video plug-in is too late.
    // https://gstreamer.freedesktop.org/documentation/gstreamer/running.html
    assert!(x11_threads_initialized(), "Xlib thread initialization failed");
    // These accessors read library constants; they do not initialize GTK.
    let version = unsafe { (
        webkit2gtk_sys::webkit_get_major_version(),
        webkit2gtk_sys::webkit_get_minor_version(),
        webkit2gtk_sys::webkit_get_micro_version(),
    ) };
    let explicit = [LEGACY, SHARED, "WEBKIT_DISABLE_COMPOSITING_MODE"]
        .iter().any(|key| std::env::var_os(key).is_some());
    if let Some(key) = default_override((version.0, version.1), explicit) {
        // Called before Tauri/GTK starts any webview or worker thread.
        std::env::set_var(key, "1");
    }
    version
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_webkit_keeps_its_accelerated_default() {
        assert_eq!(default_override((2, 44), false), None);
        assert_eq!(default_override((2, 50), false), None);
    }
    #[test]
    fn damage_tracking_keeps_the_compositor_and_full_shared_frames() {
        assert_eq!(default_override((2, 54), false), Some(SHARED));
        assert_eq!(default_override((2, 56), false), Some(SHARED));
        assert_eq!(default_override((3, 0), false), Some(SHARED));
    }
    #[test]
    fn explicit_settings_are_never_overridden() {
        assert_eq!(default_override((2, 50), true), None);
        assert_eq!(default_override((2, 54), true), None);
    }
}
