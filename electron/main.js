// Zenith desktop app (Electron). The interface lives in ../app and is served from
// app://zenith/ so it runs exactly like the web version. This file adds what a
// browser can't do: requests without CORS limits, an always-on-top mini player,
// media keys, downloads for offline viewing, Discord status, and updates.
'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, shell, session, globalShortcut, Notification, dialog, screen, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const http = require('../shared/http');
const discord = require('./discord');
const { probeScript } = require('../shared/kavita-web-login');

const APP_DIR = path.join(__dirname, '..', 'app');
const WINDOW_ICON = process.platform === 'win32'
  ? (app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '..', 'build', 'icon.ico'))
  : path.join(__dirname, '..', 'build', 'icon.png');
const REPO = require('../package.json').build?.publish?.[0] || {};
const STATE_FILE = () => path.join(app.getPath('userData'), 'window.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
if (process.platform === 'win32') app.setAppUserModelId('com.glitch.zenith');
if (!app.requestSingleInstanceLock()) app.quit();
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

let win = null;
let normalBounds = null; // where the window was before the mini player

function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch { return {}; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  const s = readState();
  if (!s.mini) s.bounds = win.isMaximized() ? s.bounds : win.getBounds();
  s.maximized = win.isMaximized();
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify(s)); } catch {}
}
// A rectangle that is actually on one of the screens
function onScreen(b) {
  if (!b) return null;
  const d = screen.getDisplayMatching(b).workArea;
  return b.x >= d.x - 50 && b.y >= d.y - 50 && b.x < d.x + d.width - 80 && b.y < d.y + d.height - 80 ? b : null;
}

function createWindow() {
  const s = readState();
  win = new BrowserWindow({
    ...(onScreen(s.bounds) || { width: 1320, height: 840 }),
    minWidth: 320, minHeight: 180,
    backgroundColor: '#151515',
    frame: false, // the app draws its own title bar (same on Windows and Linux)
    show: false,
    icon: WINDOW_ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (process.platform === 'win32') {
    win.setIcon(WINDOW_ICON);
    win.setAppDetails({ appId: 'com.glitch.zenith', appIconPath: WINDOW_ICON, appIconIndex: 0, relaunchCommand: '"' + process.execPath + '"', relaunchDisplayName: 'Zenith' });
  }
  if (s.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://zenith/index.html');
  for (const ev of ['resize', 'move', 'close']) win.on(ev, saveState);
  win.on('maximize', () => send('window', { maximized: true }));
  win.on('unmaximize', () => send('window', { maximized: false }));
  win.on('enter-full-screen', () => send('window', { fullscreen: true }));
  win.on('leave-full-screen', () => send('window', { fullscreen: false }));
  // Links to other sites open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://zenith/')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send('zenith', { channel, data }); };

// The mini player: small, always on top, on the corner of the screen
function setMini(on) {
  if (!win) return;
  const s = readState();
  if (on) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    normalBounds = win.getBounds();
    const area = screen.getDisplayMatching(normalBounds).workArea;
    const saved = onScreen(s.miniBounds);
    const w = 480, h = 270;
    win.setMinimumSize(240, 135);
    win.setBounds(saved || { x: area.x + area.width - w - 24, y: area.y + area.height - h - 24, width: w, height: h });
    win.setAspectRatio(16 / 9);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    s.mini = true;
  } else {
    s.miniBounds = win.getBounds();
    win.setAspectRatio(0);
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
    win.setMinimumSize(320, 180);
    win.setBounds(normalBounds || s.bounds || { width: 1320, height: 840 });
    s.mini = false;
  }
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify(s)); } catch {}
  send('window', { mini: on });
}

// Downloads for offline viewing, saved in Downloads/Zenith
const downloads = new Map();
async function download({ url, name, id }) {
  const dir = path.join(app.getPath('downloads'), 'Zenith');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(name || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 150) || 'video';
  const file = path.join(dir, safe);
  const ctrl = new AbortController();
  downloads.set(id, ctrl);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const total = Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(file + '.part');
    let got = 0, last = 0;
    for await (const chunk of res.body) {
      out.write(chunk); got += chunk.length;
      if (Date.now() - last > 400) { last = Date.now(); send('download', { id, got, total }); }
    }
    await new Promise((r) => out.end(r));
    fs.renameSync(file + '.part', file);
    send('download', { id, got, total: total || got, done: true, file });
    if (Notification.isSupported()) new Notification({ title: 'Download finished', body: safe }).show();
  } catch (e) {
    try { fs.rmSync(file + '.part', { force: true }); } catch {}
    send('download', { id, error: e.name === 'AbortError' ? 'Cancelled' : e.message });
  } finally { downloads.delete(id); }
}

// Updates: Windows installer and AppImage update themselves; .deb and .rpm get a link
let updater = null;
function canSelfUpdate() { return app.isPackaged && (process.platform === 'win32' || !!process.env.APPIMAGE); }
function initUpdates() {
  if (!canSelfUpdate()) return;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-available', (i) => send('update', { state: 'downloading', version: i.version }));
    updater.on('download-progress', (p) => send('update', { state: 'downloading', percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (i) => send('update', { state: 'ready', version: i.version }));
    updater.on('error', (e) => send('update', { state: 'error', message: String(e?.message || e).slice(0, 200) }));
  } catch { updater = null; }
}
async function checkUpdates() {
  if (updater) { try { await updater.checkForUpdates(); } catch {} return { self: true }; }
  // Fallback: ask GitHub for the newest release and compare versions
  if (!REPO.owner || REPO.owner === 'OWNER') return { self: false };
  try {
    const r = await http.request(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`, { headers: { 'User-Agent': 'Zenith', Accept: 'application/vnd.github+json' } });
    const rel = JSON.parse(r.body);
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (latest && newer(latest, app.getVersion())) send('update', { state: 'manual', version: latest, url: rel.html_url });
  } catch {}
  return { self: false };
}
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

function registerIpc() {
  ipcMain.handle('http', (e, url, opts) => http.request(url, { ...opts, session: 'desktop' }));
  ipcMain.handle('http-forget', (e, origin) => http.forget('desktop', origin));
  ipcMain.handle('info', () => ({ version: app.getVersion(), platform: process.platform, selfUpdate: canSelfUpdate(), repo: REPO.owner && REPO.owner !== 'OWNER' ? `${REPO.owner}/${REPO.repo}` : '' }));
  ipcMain.handle('win', (e, action, arg) => {
    if (!win) return null;
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
    if (action === 'fullscreen') win.setFullScreen(arg ?? !win.isFullScreen());
    if (action === 'mini') setMini(arg ?? !readState().mini);
    if (action === 'pin') win.setAlwaysOnTop(!!arg, 'floating');
    if (action === 'opacity') win.setOpacity(Math.min(1, Math.max(0.3, Number(arg) || 1)));
    if (action === 'focus') { if (win.isMinimized()) win.restore(); win.focus(); }
    return { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), mini: !!readState().mini, pinned: win.isAlwaysOnTop() };
  });
  ipcMain.handle('open', (e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  ipcMain.handle('show-file', (e, file) => { if (file && fs.existsSync(file)) shell.showItemInFolder(file); });
  ipcMain.handle('download', (e, job) => { download(job); return true; });
  ipcMain.handle('download-cancel', (e, id) => { downloads.get(id)?.abort(); });
  ipcMain.handle('notify', (e, title, body) => { if (Notification.isSupported()) new Notification({ title: String(title).slice(0, 80), body: String(body || '').slice(0, 200) }).show(); });
  ipcMain.handle('update-check', () => checkUpdates());
  ipcMain.handle('update-install', () => { if (updater) setImmediate(() => updater.quitAndInstall(false, true)); });
  ipcMain.handle('discord', (e, activity) => discord.set(activity));
  // Sign in through a server's own website (for single sign-on, like Kavita's "Jellyfin" button).
  // Opens the site in its own window and waits until the site saves the signed-in user, then
  // hands back only that saved sign-in. The window has no access to the app.
  ipcMain.handle('web-login', (e, url) => new Promise((resolve) => {
    let target; try { target = new URL(url); } catch { return resolve(null); }
    const w = new BrowserWindow({ parent: win, icon: WINDOW_ICON, width: 520, height: 760, title: 'Sign in', backgroundColor: '#151515', autoHideMenuBar: true,
      webPreferences: { partition: 'persist:web-login', contextIsolation: true, sandbox: true, nodeIntegration: false } });
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearInterval(t); if (!w.isDestroyed()) w.close(); resolve(v); };
    let checking = false;
    const check = async () => {
      if (done || checking) return;
      checking = true;
      try {
      if (w.isDestroyed()) return finish(null);
      if (new URL(w.webContents.getURL() || 'about:blank').origin !== target.origin) return;
      const found = await w.webContents.executeJavaScript(probeScript).catch(() => null);
      if (!found || done || w.isDestroyed()) return;
      if (new URL(w.webContents.getURL()).origin !== target.origin) return;
      if (found.cookie) {
        const cookies = await w.webContents.session.cookies.get({ url: target.origin + '/api/Account' });
        if (!cookies.length) return;
        http.importCookies('desktop', target.origin, cookies);
        const response = await http.request(target.origin + '/api/Account', { session: 'desktop' });
        if (!response.ok) return;
        const account = JSON.parse(response.body);
        if (account.username !== found.username) return;
      }
      finish(found);
      } catch {} finally { checking = false; }
    };
    const t = setInterval(check, 500);
    w.webContents.on('did-finish-load', check);
    w.webContents.on('did-navigate-in-page', check);
    w.on('closed', () => finish(null));
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.loadURL(target.origin + '/login');
  }));
  ipcMain.handle('confirm', async (e, message) => (await dialog.showMessageBox(win, { type: 'question', buttons: ['Yes', 'Cancel'], defaultId: 0, message })).response === 0);
}

// Sign-in cookies (request site, Seerr) survive restarts, encrypted with the OS keychain when it's available
const COOKIES = () => path.join(app.getPath('userData'), 'sessions.bin');
function loadCookies() {
  try {
    const raw = fs.readFileSync(COOKIES());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    http.load(JSON.parse(text));
  } catch {}
}
let cookieT = null;
http.watch(() => { clearTimeout(cookieT); cookieT = setTimeout(() => {
  try { const text = JSON.stringify(http.dump()); fs.writeFileSync(COOKIES(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text), { mode: 0o600 }); } catch {}
}, 500); });

app.whenReady().then(() => {
  loadCookies();
  // Serve the interface from app://zenith/
  protocol.handle('app', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(APP_DIR, p === '/' ? 'index.html' : p));
    if (!file.startsWith(APP_DIR)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Video streams and subtitles come straight from the user's servers. Let the app read them.
  session.defaultSession.webRequest.onHeadersReceived((d, cb) => {
    const h = d.responseHeaders || {};
    if (d.referrer?.startsWith('app://zenith') || d.url.startsWith('http')) {
      for (const k of Object.keys(h)) if (/^access-control-allow-(origin|credentials)$/i.test(k)) delete h[k];
      h['Access-Control-Allow-Origin'] = ['app://zenith'];
      h['Access-Control-Allow-Credentials'] = ['true'];
    }
    cb({ responseHeaders: h });
  });
  registerIpc();
  createWindow();
  initUpdates();
  setTimeout(checkUpdates, 8000);
  setInterval(checkUpdates, 6 * 60 * 60 * 1000);
  for (const [key, action] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'previous'], ['MediaStop', 'stop']]) {
    try { globalShortcut.register(key, () => send('media-key', action)); } catch {}
  }
  discord.start();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('will-quit', () => { globalShortcut.unregisterAll(); discord.stop(); });
app.on('window-all-closed', () => app.quit());
