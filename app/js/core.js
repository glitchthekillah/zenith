// Shared pieces: settings, server requests, routing and small UI helpers.
export const desktop = window.zenithDesktop || null;
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ── Saved settings (this device only) ─────────────────────────────────
const KEY = 'zenith';
const defaults = {
  theme: 'dark', accent: '#e8a33d',
  servers: { jellyfin: null, kavita: null, seerr: null, ask: null }, // { url, token, userId, name, ... }
  playback: { directPlay: true, maxBitrate: 0, autoplayNext: true, skipIntro: true, subtitles: 'smart', subtitleSize: 100, subPreset: 'zenith', subColor: '#ffffff', subOpacity: 100, subFont: 'sans', subWeight: 600, subEdge: 'shadow', subBg: 'line', subBgColor: '#000000', subBgOpacity: 55, subPos: 6, sv: 1, volume: 1, rate: 1, audioLang: 'eng', subLang: 'eng' },
  reader: { mode: 'paged', direction: 'ltr', fit: 'height', bookFont: 19, bookTheme: 'dark' },
  app: { covers: true, rewatch: true, discord: true, notify: true, miniOnBlur: false, startPage: 'home' },
  // Only on this device: never sent to any server
  profile: { name: '', avatar: '' },
  look: { preset: 'zenith', colors: null },
  seen: {}, // request ids we already told the user about
};
const merge = (a, b) => { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) a[k] = merge({ ...(a[k] || {}) }, b[k]); else if (a[k] === undefined) a[k] = b[k]; } return a; };
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
export const settings = merge(saved, defaults);
export function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} }

// A stable id for this install (servers use it to tell devices apart)
export const deviceId = (() => { let id = localStorage.getItem('zenith-device'); if (!id) { id = crypto.randomUUID().replace(/-/g, ''); try { localStorage.setItem('zenith-device', id); } catch {} } return id; })();
const webSession = (() => { let id = sessionStorage.getItem('zenith-web') || localStorage.getItem('zenith-web'); if (!id) { id = crypto.randomUUID().replace(/-/g, ''); try { localStorage.setItem('zenith-web', id); } catch {} } return id; })();
export const VERSION = '0.1.0';

// ── Requests to the user's servers ────────────────────────────────────
// The desktop app makes them itself; the web version goes through its small server.
export class HttpError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function http(url, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const opts = { method, headers: { Accept: 'application/json', ...headers } };
  if (body !== undefined) { opts.body = typeof body === 'string' ? body : JSON.stringify(body); if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json'; }
  let r;
  if (desktop) r = await desktop.http(url, opts);
  else {
    const res = await fetch('/api/http', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zenith-Session': webSession }, body: JSON.stringify({ url, ...opts }) });
    r = await res.json().catch(() => ({ error: 'The Zenith web server did not answer.' }));
    if (!res.ok) throw new HttpError(r.error || 'Request failed.', res.status);
  }
  if (raw) return r;
  let data = r.body;
  if (!r.base64 && /json/.test(r.headers?.['content-type'] || '') && data) { try { data = JSON.parse(data); } catch {} }
  if (!r.ok) {
    const msg = (data && typeof data === 'object' && (data.message || data.title || data.error)) || (typeof data === 'string' && data.length < 200 && !/</.test(data) ? data : '') || `The server answered ${r.status}.`;
    throw new HttpError(r.status === 401 ? 'Your sign-in expired. Sign in again.' : msg, r.status);
  }
  return data;
}
export const cleanUrl = (u) => { let s = String(u || '').trim(); if (!s) return ''; if (!/^https?:\/\//i.test(s)) s = 'https://' + s; try { const x = new URL(s); return (x.origin + x.pathname).replace(/\/+$/, ''); } catch { return ''; } };

// ── Events (simple pub/sub between parts of the app) ───────────────────
const bus = new EventTarget();
export const on = (name, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(name, h); return () => bus.removeEventListener(name, h); };
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

// ── Routing: #/page/arg ────────────────────────────────────────────────
const routes = {};
export const route = (name, fn) => { routes[name] = fn; };
export const go = (hash) => { if (location.hash === '#' + hash) render(); else location.hash = hash; };
export const current = () => { const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/'); return { name: name || settings.app.startPage || 'home', args: rest.map(decodeURIComponent) }; };
let renderId = 0;
export async function render() {
  const { name, args } = current();
  const id = ++renderId;
  const view = $('#view');
  emit('route', { name, args });
  const fn = routes[name] || routes.home;
  view.setAttribute('aria-busy', 'true');
  try {
    const html = await fn(...args);
    if (id !== renderId) return; // a newer page was opened meanwhile
    if (typeof html === 'string') { view.innerHTML = html; view.scrollTop = 0; window.scrollTo(0, 0); }
    emit('rendered', { name, args });
  } catch (e) {
    if (id !== renderId) return;
    view.innerHTML = errorBox(e);
  } finally { if (id === renderId) view.removeAttribute('aria-busy'); }
}
window.addEventListener('hashchange', render);

// ── UI helpers ─────────────────────────────────────────────────────────
export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.setAttribute('role', 'status'); t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}
export const errorBox = (e, retry = true) => `<div class="empty"><h2>Something went wrong</h2><p>${esc(e?.message || e)}</p>${retry ? '<button class="btn" data-act="reload">Try again</button>' : ''}</div>`;
export const loading = (n = 12, kind = 'poster') => `<div class="grid ${kind}">${Array.from({ length: n }, () => `<div class="card skeleton"><div class="art"></div><div class="line"></div></div>`).join('')}</div>`;
export function modal(html, { wide = false, onClose } = {}) {
  const d = document.createElement('dialog');
  d.className = `modal${wide ? ' wide' : ''}`;
  d.innerHTML = `<button class="modal-x icon-btn" data-close aria-label="Close">${icon('x')}</button>${html}`;
  document.body.append(d);
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => { onClose?.(); d.remove(); });
  d.showModal();
  return d;
}
export const confirmBox = (message, yes = 'Yes') => new Promise((ok) => {
  const d = modal(`<h2>${esc(message)}</h2><div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-yes>${esc(yes)}</button></div>`, { onClose: () => ok(false) });
  d.querySelector('[data-yes]').onclick = () => { ok(true); d.close(); };
});
export const fmtTime = (s) => { if (!Number.isFinite(s) || s < 0) s = 0; s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
export const fmtRuntime = (ticks) => { const m = Math.round((ticks || 0) / 6e8); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m ? `${m}m` : ''; };
export const fmtBytes = (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return `${(b / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`; };
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Icons: 24px line icons
const P = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', film: 'M4 4h16v16H4z M8 4v16 M16 4v16 M4 8h4 M4 12h4 M4 16h4 M16 8h4 M16 12h4 M16 16h4',
  tv: 'M3 6h18v12H3z M8 21h8 M12 18v3', book: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3z',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0', plus: 'M12 5v14 M5 12h14', x: 'M6 6l12 12 M18 6L6 18', check: 'M5 12l4 4L19 6',
  play: 'M7 4.5v15l13-7.5z', pause: 'M7 4h3.5v16H7z M13.5 4H17v16h-3.5z', heart: 'M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5c-2.3 4.6-9.3 9-9.3 9z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  inbox: 'M3 13h5l2 3h4l2-3h5 M5 5h14l2 8v6H3v-6z', download: 'M12 3v12 M7 10l5 5 5-5 M4 19h16', back: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7',
  pip: 'M3 5h18v14H3z M12 11h7v6h-7z', expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5', shrink: 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5',
  volume: 'M11 5L6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7 M18.5 5.5a9 9 0 0 1 0 13', mute: 'M11 5L6 9H2v6h4l5 4z M22 9l-6 6 M16 9l6 6',
  subs: 'M3 5h18v14H3z M7 13h3 M13 13h4 M7 16h6 M15 16h2', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', skipb: 'M4 12a8 8 0 1 0 2.4-5.7 M4 3v4h4', skipf: 'M20 12a8 8 0 1 1-2.4-5.7 M20 3v4h-4',
  prev: 'M6 5v14 M18 5l-9 7 9 7z', nextep: 'M18 5v14 M6 5l9 7-9 7z', list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', refresh: 'M20 8a8 8 0 1 0 1 6 M20 3v5h-5', shuffle: 'M16 3h5v5 M4 20 21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5',
  pin: 'M12 17v5 M5 17h14l-2-5V5h1V3H6v2h1v7z', minimize: 'M5 12h14', maximize: 'M5 5h14v14H5z', restore: 'M8 8h11v11H8z M5 16V5h11', logout: 'M9 4H4v16h5 M9 12h12 M17 8l4 4-4 4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0', clock: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sun: 'M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6 4.2 4.2 M19.8 19.8l-1.4-1.4 M5.6 18.4l-1.4 1.4 M19.8 4.2l-1.4 1.4 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3', music: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  speed: 'M12 14l4-6 M4 18a9 9 0 1 1 16 0', lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4', cast: 'M2 16a5 5 0 0 1 5 5 M2 12a9 9 0 0 1 9 9 M2 8V5h20v14h-7 M2 20h.01',
};
export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n] || P.grid}"/></svg>`;
