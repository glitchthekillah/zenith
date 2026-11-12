// The bridge between the interface and the desktop app (Tauri). Gives the page the same
// window.zenithDesktop the rest of the code uses. In a normal browser this does nothing.
'use strict';
(() => {
  const T = window.__TAURI__;
  if (!T || !T.core) return;
  const invoke = T.core.invoke;

  // First launch after the old Electron app: take over its settings and sign-ins
  const old = window.__zenithMigrate;
  if (old && typeof old === 'object') {
    try { if (localStorage.getItem('zenith') == null) for (const [k, v] of Object.entries(old)) localStorage.setItem(k, v); } catch {}
    invoke('migrated').catch(() => {});
  }

  const listeners = new Set();
  T.event.listen('zenith', (e) => { const m = e.payload || {}; for (const fn of listeners) { try { fn(m.channel, m.data); } catch {} } });

  window.zenithDesktop = {
    nativeVideo: /Linux/i.test(globalThis.navigator?.platform || '') && !/Android/i.test(globalThis.navigator?.userAgent || ''),
    http: (url, opts) => invoke('http', { url, opts: opts || {} }),
    forget: (origin) => invoke('http_forget', { origin: origin || null }),
    info: () => invoke('info'),
    audioOpen: (rate) => invoke('audio_open', {rate}),
    audioWrite: (id, generation, samples) => invoke('audio_write', {id, generation, samples}),
    audioFlush: (id, generation) => invoke('audio_flush', {id, generation}),
    audioClose: (id) => invoke('audio_close', {id}),
    win: (action, arg) => invoke('win', { action, arg: arg ?? null }),
    open: (url) => invoke('open', { url }),
    showFile: (file) => invoke('show_file', { file: file || null }),
    download: (job) => invoke('download', { job }),
    cancelDownload: (id) => invoke('download_cancel', { id }),
    notify: (title, body) => invoke('notify_cmd', { title: String(title), body: body == null ? null : String(body) }),
    checkUpdates: () => invoke('update_check'),
    installUpdate: () => invoke('update_install'),
    discord: (activity) => invoke('discord_set', { activity: activity || null }),
    webLogin: (url) => invoke('web_login', { url }),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    focused: () => focused,
  };

  // Whether the Zenith window is the one in front. document.hasFocus() isn't reliable inside
  // the Windows webview, so ask the window itself. Tells the page with zenith-focus / zenith-blur.
  let focused = true;
  try {
    T.window.getCurrentWindow().onFocusChanged(({ payload }) => {
      focused = !!payload;
      window.dispatchEvent(new Event(focused ? 'zenith-focus' : 'zenith-blur'));
    }).catch(() => {});
  } catch {}

  // Dragging the window: the title bar, and in the mini player its top bar and the video
  // (what -webkit-app-region did in Electron). Buttons and menus stay clickable.
  const dragFrom = (t) => {
    if (!t?.closest || t.closest('button, a, input, select, textarea, [role=slider], .tb-buttons')) return false;
    if (t.closest('#titlebar')) return true;
    return document.body.classList.contains('mini') && !!t.closest('#player .pl-top, #player video');
  };
  // The drag starts once the mouse moves, so a double click still reaches the page
  let press = null;
  document.addEventListener('mousedown', (e) => { press = e.button === 0 && e.detail < 2 && dragFrom(e.target) ? { x: e.screenX, y: e.screenY } : null; });
  document.addEventListener('mousemove', (e) => {
    if (!press) return;
    if (!(e.buttons & 1)) { press = null; return; }
    if (Math.abs(e.screenX - press.x) + Math.abs(e.screenY - press.y) < 4) return;
    press = null;
    T.window.getCurrentWindow().startDragging().catch(() => {});
  });
  document.addEventListener('mouseup', () => { press = null; });
})();
