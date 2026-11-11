// Settings, first-run setup, downloads and the update notice.
import { $, $$, esc, icon, route, go, render, settings, save, toast, desktop, cleanUrl, modal, confirmBox, fmtBytes, on, emit, VERSION, groups } from './core.js';
import * as jf from './jellyfin.js';
import * as kv from './kavita.js';
import * as seerr from './seerr.js';
import * as rq from './requests.js';
import { avatarHtml, hasAvatar, pickAvatar, clearAvatar } from './avatar.js';
import { LANGS, SUB_COLORS, SUB_BG_COLORS, SUB_BGS, SUB_EDGES, SUB_FONTS, SUB_WEIGHTS, SUB_PRESETS, subDefaults, applySubStyle } from './tracks.js';

// Background palettes: ink (the darkest), two clouds and the light thread
export const PALETTES = [
  ['zenith', 'Zenith', ['#07060d', '#4d2bbf', '#9e296b', '#ffa847']],
  ['ocean', 'Ocean', ['#03080f', '#0f4c81', '#127a8a', '#7fe3ff']],
  ['forest', 'Forest', ['#040a06', '#1d5a3a', '#4a6b1f', '#d8f27a']],
  ['ember', 'Ember', ['#0c0504', '#8a1c1c', '#c2410c', '#ffd166']],
  ['sakura', 'Sakura', ['#0d0610', '#7a2e6b', '#d0587e', '#ffd1e3']],
  ['aurora', 'Aurora', ['#03060c', '#1e3a8a', '#0f766e', '#a7f3d0']],
  ['mono', 'Mono', ['#060606', '#2b2b33', '#4a4a55', '#d9d9e3']],
];
const skyColors = () => settings.look.colors || PALETTES.find((p) => p[0] === settings.look.preset)?.[2] || PALETTES[0][2];
// Highlight (labels, rings, checks) and button colours, chosen in Appearance
export const ACCENTS = [
  ['zenith', 'Zenith', '#ffb547', ['#ffb547', '#ff6fa5']], ['ocean', 'Ocean', '#38bdf8', ['#38bdf8', '#6366f1']], ['mint', 'Mint', '#34d399', ['#34d399', '#22d3ee']],
  ['rose', 'Rose', '#fb7185', ['#fb7185', '#e879f9']], ['sunset', 'Sunset', '#fb923c', ['#f97316', '#ef4444']], ['violet', 'Violet', '#a78bfa', ['#a78bfa', '#ec4899']], ['mono', 'Mono', '#e5e7eb', ['#f4f4f5', '#a1a1aa']],
];
const rgbOf = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lum = (h) => { const [r, g, b] = rgbOf(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const darken = (h, t) => '#' + rgbOf(h).map((v) => Math.round(v * (1 - t)).toString(16).padStart(2, '0')).join('');
export const accentNow = () => { const a = settings.look.accent || {}; const pre = ACCENTS.find((x) => x[0] === (a.preset || 'zenith')) || ACCENTS[0]; return { hl: a.hl || pre[2], btn: a.btn || pre[3] }; };
export function applyAccent() {
  const { hl, btn } = accentNow(), root = document.documentElement.style;
  root.setProperty('--amber', hl); root.setProperty('--amber-rgb', rgbOf(hl).join(','));
  root.setProperty('--btn1', btn[0]); root.setProperty('--btn2', btn[1]); root.setProperty('--pink-rgb', rgbOf(btn[1]).join(','));
  root.setProperty('--btn-ink', (lum(btn[0]) + lum(btn[1])) / 2 > 0.32 ? '#14101a' : '#ffffff');
  // On light backgrounds the highlight is deepened until it reads as text
  let t = hl, k = 0; if (document.documentElement.dataset.theme === 'light') while (lum(t) > 0.18 && k++ < 12) t = darken(t, 0.12);
  root.setProperty('--hl-text', t);
}
export function applySky() { const c = skyColors(); window.zenithSky?.set(c); const sky = document.querySelector('.sky'); if (sky && !document.body.classList.contains('liquid')) sky.style.background = c[0]; }
const SERVERS = [
  ['jellyfin', 'Jellyfin', 'Movies, shows and anime to watch.', 'Username'],
  ['kavita', 'Kavita', 'Books, manga and comics to read.', 'Username'],
  ['ask', 'Request site', 'An ask site (like zenith\'s) for movies, shows, books and manga.', 'Jellyfin username'],
  ['seerr', 'Seerr', 'Jellyseerr, Overseerr or Seerr for movie and show requests.', 'Jellyfin username'],
];
// One card per server group: its name, then each service with Connect or Sign out
function srvCard(g) {
  const sv = g.servers || {}, on = SERVERS.filter(([k]) => sv[k]).length, name = groups.nameOf(g);
  return `<section class="srv-card" data-gid="${g.id}"><header><span class="srv-orb">${esc(name.slice(0, 1).toUpperCase())}</span>
    <div class="srv-title"><input class="srv-name" data-group-name="${g.id}" value="${esc(g.name || '')}" placeholder="${esc(on ? name : 'New server')}" maxlength="28" aria-label="Server name"><small>${on ? `${on} of ${SERVERS.length} connected` : 'Connect something to get started'}</small></div>
    ${groups.list().length > 1 ? `<button class="icon-btn" data-group-remove="${g.id}" title="Remove this server">${icon('x')}</button>` : ''}</header>
    ${SERVERS.map(([k, label, desc]) => { const x = sv[k]; let host = ''; try { host = x ? new URL(x.url).host : ''; } catch {} return `<div class="srv-row ${x ? 'on' : ''}"><span class="srv-dot"></span><div><b>${esc(label)}</b><small>${x ? esc(`${x.name || 'Signed in'} on ${host}`) : esc(desc)}</small></div>${x ? `<button class="btn small" data-disconnect="${k}" data-gid="${g.id}">Sign out</button>` : `<button class="btn small gold" data-add="${k}" data-gid="${g.id}">Connect</button>`}</div>`; }).join('')}
    ${sv.ask && sv.seerr ? '<small class="hint">Both request servers are connected: the request site is used, since it covers books and manga too.</small>' : ''}</section>`;
}
const connected = (k) => !!(k === 'jellyfin' ? jf.ready() : k === 'kavita' ? kv.ready() : k === 'seerr' ? seerr.ready() : settings.servers.ask?.name);

// First run: Jellyfin first (it's the main thing), everything else optional
route('welcome', async () => `<div class="login"><div class="login-card"><div class="gateorb"></div><h1>Welcome to Zenith</h1><p>Watch, read and request from your own servers, all in one place.</p>
  <form id="first-form"><label class="lab">Jellyfin server address<div class="field">${icon('link')}<input name="url" placeholder="https://jellyfin.example.com" autocomplete="url" required></div></label>
  <label class="lab">Username<div class="field">${icon('user')}<input name="username" autocomplete="username" required></div></label>
  <label class="lab">Password<div class="field">${icon('lock')}<input name="password" type="password" autocomplete="current-password"></div></label>
  <p class="err" id="first-err"></p><button class="btn gold big">Sign in</button></form>
  <button class="btn" style="width:100%;margin-top:10px" data-qc>Use Quick Connect instead</button>
  <small>No Jellyfin? <a href="#/settings">Set up other servers</a> instead. Your password goes only to your server.</small></div></div>`);

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'first-form') {
    e.preventDefault();
    const f = e.target, err = $('#first-err'), btn = $('button', f);
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      const url = cleanUrl(f.url.value);
      if (!url) throw new Error('Enter the server address.');
      const s = await jf.signIn(url, f.username.value.trim(), f.password.value);
      toast(`Signed in as ${s.name}`, 'ok');
      // Try the same account on a request site next to it, quietly
      go('/settings/after-first');
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Sign in'; }
  }
  if (e.target.matches('[data-connect]')) {
    e.preventDefault();
    const f = e.target, kind = f.dataset.connect, err = $('.err', f), btn = $('button[type=submit],button:not([type])', f);
    err.textContent = ''; btn.disabled = true; const was = btn.textContent; btn.textContent = 'Connecting...';
    try {
      const url = cleanUrl(f.url.value); if (!url) throw new Error('Enter the server address.');
      const u = f.username.value.trim(), p = f.password.value;
      const home = groups.home(url, f.dataset.gid || groups.active().id); groups.use(home.id);
      if (kind === 'jellyfin') await jf.signIn(url, u, p);
      if (kind === 'kavita') await kv.signIn(url, u, p);
      if (kind === 'seerr') await seerr.signIn(url, u, p, f.local?.checked ? 'local' : 'jellyfin');
      if (kind === 'ask') await rq.askSignIn(url, u, p);
      toast(groups.list().length > 1 ? `Connected to ${groups.nameOf(groups.active())}` : 'Connected', 'ok'); f.closest('dialog')?.close(); emit('servers'); render();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = was; }
  }
});
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-qc]')) return quickConnect();
  const kw = e.target.closest('[data-kavita-web]');
  if (kw) {
    const f = kw.closest('dialog').querySelector('[data-connect=kavita]'), err = $('.err', f);
    const url = cleanUrl(f.url.value); if (!url) { err.textContent = 'Enter the Kavita address first.'; return; }
    kw.disabled = true; kw.textContent = 'Waiting for you to sign in...'; err.textContent = '';
    try { groups.use(groups.home(url, f.dataset.gid || groups.active().id).id); await kv.signInWithWebsite(url); toast('Connected to Kavita', 'ok'); kw.closest('dialog').close(); emit('servers'); render(); }
    catch (ex) { err.textContent = ex.message; kw.disabled = false; kw.textContent = 'Sign in on the Kavita website'; }
    return;
  }
  const c = e.target.closest('[data-add]'); if (c) { if (c.dataset.gid) groups.use(c.dataset.gid); return connectDialog(c.dataset.add, c.dataset.gid); }
  if (e.target.closest('[data-group-add]')) { groups.add(); return render(); }
  const gr = e.target.closest('[data-group-remove]');
  if (gr) { const g = groups.byId(gr.dataset.groupRemove); if (!(await confirmBox(`Remove ${groups.nameOf(g)} and sign out of everything on it?`, 'Remove'))) return; groups.remove(g.id); emit('servers'); return render(); }
  const d = e.target.closest('[data-disconnect]');
  if (d) {
    const k = d.dataset.disconnect;
    if (d.dataset.gid) groups.use(d.dataset.gid);
    if (!(await confirmBox(`Sign out of ${SERVERS.find((s) => s[0] === k)[1]}?`, 'Sign out'))) return;
    if (k === 'jellyfin') await jf.signOut(); if (k === 'kavita') kv.signOut(); if (k === 'seerr') await seerr.signOut(); if (k === 'ask') await rq.askSignOut();
    emit('servers'); render();
  }
  const ac = e.target.closest('[data-accent]');
  if (ac) { settings.look.accent = { preset: ac.dataset.accent }; save(); const de = document.documentElement; de.classList.add('glide'); setTimeout(() => de.classList.remove('glide'), 1000); applyAccent(); $$('[data-accent]').forEach((b) => b.classList.toggle('on', b === ac)); const now = accentNow(); $$('[data-accent-pick]').forEach((i) => { i.value = i.dataset.accentPick === 'hl' ? now.hl : now.btn[i.dataset.accentPick === 'b0' ? 0 : 1]; }); return; }
  const pp = e.target.closest('[data-sky-preset]');
  if (pp) { settings.look = { preset: pp.dataset.skyPreset, colors: null }; save(); applySky(); $$('[data-sky-preset]').forEach((b) => b.classList.toggle('on', b === pp)); skyInputs(); }
  if (e.target.closest('[data-avatar-clear]')) return clearAvatar();
  const sp = e.target.closest('[data-subpick]');
  if (sp) { const [k, v] = sp.dataset.subpick.split(/:(.*)/); settings.playback[k] = k === 'subWeight' ? Number(v) : v; settings.playback.subPreset = 'custom'; $$('[data-subpreset]').forEach((b) => b.classList.remove('on')); save(); sp.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === sp)); const pv = $('#sub-preview'); if (pv) applySubStyle(pv); return; }
  if (e.target.closest('[data-subreset]')) { Object.assign(settings.playback, subDefaults); save(); render(); return; }
  const pr = e.target.closest('[data-subpreset]');
  if (pr) { Object.assign(settings.playback, SUB_PRESETS.find((x) => x[0] === pr.dataset.subpreset)[2]); save(); render(); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { setTab = tb.dataset.tab; $$('[data-tab]').forEach((b) => b.classList.toggle('on', b === tb)); $$('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== setTab; }); return; }
  const t = e.target.closest('[data-theme-pick]'); if (t) { settings.theme = t.dataset.themePick; save(); applyTheme(); $$('[data-theme-pick]').forEach((b) => b.classList.toggle('on', b === t)); }
  if (e.target.closest('[data-check-updates]')) { const r = await desktop?.checkUpdates(); toast(r?.self ? 'Checking for updates...' : 'Checked. You will be told here if a new version is out.'); }
  if (e.target.closest('[data-reset]')) { if (await confirmBox('Sign out of everything and forget all settings on this device?', 'Reset')) { localStorage.clear(); location.hash = ''; location.reload(); } }
  if (e.target.closest('[data-export]')) { const blob = new Blob([JSON.stringify({ ...settings, servers: Object.fromEntries(Object.entries(settings.servers).map(([k, v]) => [k, v ? { url: v.url } : null])) }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zenith-settings.json'; a.click(); }
});
const skyInputs = () => { const c = skyColors(); $$('[data-sky]').forEach((i) => { i.value = c[Number(i.dataset.sky)]; }); };
document.addEventListener('input', (e) => {
  const ss = e.target.closest('[data-substyle]');
  const sc = e.target.closest('[data-subcolor]');
  if (sc) { settings.playback.subColor = sc.value; settings.playback.subPreset = 'custom'; sc.parentElement.parentElement.querySelectorAll('.sub-swatch').forEach((x) => x.classList.toggle('on', x === sc.parentElement)); save(); const pv = $('#sub-preview'); if (pv) applySubStyle(pv); return; }
  if (ss) { settings.playback[ss.dataset.substyle] = Number(ss.value); settings.playback.subPreset = 'custom'; $$('[data-subpreset]').forEach((b) => b.classList.remove('on')); save(); ss.nextElementSibling.textContent = ss.value + '%'; const pv = $('#sub-preview'); if (pv) applySubStyle(pv); return; }
  const ap = e.target.closest('[data-accent-pick]');
  if (ap) { const now = accentNow(); const a = { preset: 'custom', hl: now.hl, btn: [...now.btn] }; if (ap.dataset.accentPick === 'hl') a.hl = ap.value; else a.btn[ap.dataset.accentPick === 'b0' ? 0 : 1] = ap.value; settings.look.accent = a; save(); applyAccent(); $$('[data-accent]').forEach((b) => b.classList.remove('on')); return; }
  const i = e.target.closest('[data-sky]'); if (!i) return;
  const c = [...skyColors()]; c[Number(i.dataset.sky)] = i.value;
  settings.look = { preset: 'custom', colors: c }; applySky(); $$('[data-sky-preset]').forEach((b) => b.classList.remove('on'));
});
document.addEventListener('change', async (e) => {
  if (e.target.closest('[data-sky]')) return save();
  const av = e.target.closest('[data-avatar]');
  if (av) { const f = av.files?.[0]; av.value = ''; if (f) pickAvatar(f); return; }
  const gn = e.target.closest('[data-group-name]');
  if (gn) { const g = groups.byId(gn.dataset.groupName); if (g) { g.name = gn.value.trim(); save(); emit('servers'); toast('Saved', 'ok'); } return; }
  const s = e.target.closest('[data-set]'); if (!s) return;
  const [group, key] = s.dataset.set.split('.');
  settings[group][key] = s.type === 'checkbox' ? s.checked : s.type === 'number' || s.dataset.num ? Number(s.value) : s.value;
  save(); toast('Saved', 'ok');
  if (group === 'profile') emit('servers');
  if (s.dataset.set === 'app.liveSky') document.body.classList.toggle('calm', !settings.app.liveSky);
  if (s.dataset.set === 'playback.subtitles') render();
});
function connectDialog(kind, gid = '') {
  const [k, name, desc, user] = SERVERS.find((s) => s[0] === kind);
  const guess = settings.servers.jellyfin?.url || '';
  modal(`<h2>Connect ${esc(name)}</h2><p style="color:var(--mute);margin:0 0 16px">${esc(desc)}</p>
    <form data-connect="${k}" data-gid="${esc(gid)}" style="display:grid;gap:12px"><label class="lab">Address<div class="field">${icon('link')}<input name="url" placeholder="https://${k}.example.com" value="${k === 'jellyfin' ? esc(guess) : ''}" required></div></label>
    <label class="lab">${esc(user)}<div class="field">${icon('user')}<input name="username" value="${k !== 'kavita' ? esc(settings.servers.jellyfin?.name || '') : ''}" autocomplete="username" ${k === 'kavita' ? '' : 'required'}></div></label>
    <label class="lab">Password<div class="field">${icon('lock')}<input name="password" type="password" autocomplete="current-password"></div></label>
    ${k === 'seerr' ? '<label class="set-row" style="border:0;padding:0"><div><b>Seerr account (email)</b><small>Instead of the Jellyfin account</small></div><span class="switch"><input type="checkbox" name="local"><span></span></span></label>' : ''}
    <p class="err"></p><button class="btn gold big">Connect</button></form>
    ${k === 'kavita' ? `<div style="display:grid;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><button class="btn big" data-kavita-web>Sign in on the Kavita website</button><small class="hint" style="margin:0">Use this if you sign in to Kavita with Jellyfin (or another sign-in button). A Kavita window opens; sign in there and it closes by itself.</small></div>` : ''}${k === 'kavita' ? `<small class="hint">Or leave the username empty and paste your Kavita API key as the password (Kavita: your account, API Key / OPDS).</small>` : ''}`);
}
async function quickConnect() {
  const url = cleanUrl($('#first-form')?.url.value || settings.servers.jellyfin?.url || '');
  if (!url) return toast('Enter the server address first.', 'bad');
  let r; try { r = await jf.quickConnectStart(url); } catch (e) { return toast(e.message, 'bad'); }
  let alive = true;
  const m = modal(`<h2>Quick Connect</h2><p style="color:var(--mute)">On a device that's already signed in to Jellyfin, open your profile, choose Quick Connect, and enter this code:</p><div class="qc-code">${esc(r.Code)}</div><p style="color:var(--dim);font-size:13px">Waiting for approval...</p>`, { onClose: () => { alive = false; } });
  while (alive) {
    await new Promise((ok) => setTimeout(ok, 3000));
    if (!alive) break;
    const s = await jf.quickConnectPoll(url, r.Secret).catch(() => null);
    if (s) { m.close(); toast(`Signed in as ${s.name}`, 'ok'); emit('servers'); go('/settings/after-first'); break; }
  }
}

let setTab = 'profile';
route('settings', async (sub) => {
  const p = settings.playback, a = settings.app;
  const info = desktop ? await desktop.info() : null;
  const intro = sub === 'after-first' ? `<div class="panel" style="margin-bottom:16px;border-color:rgba(255,181,71,.45)"><h2>You're in</h2><p>Want books, manga and requests too? Connect Kavita and a request site below with the same kind of sign-in. Or skip and <a href="#/home">start watching</a>.</p></div>` : '';
  const sw = (key, label, small) => { const [g, k] = key.split('.'); return `<label class="set-row"><div><b>${label}</b>${small ? `<small>${small}</small>` : ''}</div><span class="switch"><input type="checkbox" data-set="${key}" ${settings[g][k] ? 'checked' : ''}><span></span></span></label>`; };
  const range = (label, key, min, max, step) => `<label class="set-row"><div><b>${label}</b></div><span class="range-row"><input type="range" min="${min}" max="${max}" step="${step}" value="${p[key]}" data-substyle="${key}"><output>${p[key]}%</output></span></label>`;
  const chips = (label, key, list) => `<div class="set-row"><div><b>${label}</b></div><span class="sub-chips">${list.map(([v, n, f]) => `<button class="chip ${String(p[key]) === String(v) ? 'on' : ''}" data-subpick="${key}:${v}"${f ? ` style="font-family:${esc(f)}"` : ''}>${n}</button>`).join('')}</span></div>`;
  const seg = (label, key, list) => `<div class="set-row"><div><b>${label}</b></div><span class="seg">${list.map(([v, n, f]) => `<button class="${String(p[key]) === String(v) ? 'on' : ''}" data-subpick="${key}:${v}"${f ? ` style="font-family:${esc(f)}"` : ''}>${n}</button>`).join('')}</span></div>`;
  const presetVars = (o) => { const d = document.createElement('div'); const keep = { ...settings.playback }; Object.assign(settings.playback, o); applySubStyle(d); Object.assign(settings.playback, keep); return d.getAttribute('style') || ''; };
  const tabs = [['profile', 'user', 'Profile'], ['look', 'sun', 'Appearance'], ['servers', 'link', 'Servers'], ['playback', 'play', 'Playback'], ['subs', 'subs', 'Audio & subtitles'], ['general', 'grid', 'General'], ['about', 'settings', 'About']];
  if (sub === 'after-first') setTab = 'servers'; else if (tabs.some((t) => t[0] === sub)) setTab = sub;
  const pane = (k, title, desc, body) => `<section class="set-pane" data-pane="${k}" ${setTab === k ? '' : 'hidden'}><header><h2>${title}</h2><p>${desc}</p></header>${body}</section>`;
  const group = (title, body) => `<div class="set-group">${title ? `<h3>${title}</h3>` : ''}<div class="set-card">${body}</div></div>`;
  const keys = [['Space', 'Play or pause'], ['Left / Right', 'Seek 10 seconds'], ['F', 'Full screen'], ['M', 'Mini player'], ['P', 'Picture in picture'], ['C', 'Subtitles'], ['N', 'Next episode'], ['/', 'Search']];
  return `<div class="page-head"><div><span class="kicker">Settings</span><h1>Make it yours</h1></div></div>${intro}
  <div class="set-wrap">
    <nav class="set-tabs" role="tablist">${tabs.map(([k, ic, l]) => `<button role="tab" data-tab="${k}" class="${setTab === k ? 'on' : ''}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>
    <div class="set-body">
    ${pane('profile', 'Profile', 'Your picture and name. Kept only in this app on this device, never sent anywhere.', `
      <div class="profile-card"><div class="profile-pic">${avatarHtml(settings.profile.name || settings.servers.jellyfin?.name || '?')}</div>
        <div class="profile-info"><b>${esc(settings.profile.name || settings.servers.jellyfin?.name || 'You')}</b><small>${icon('lock')} Stored on this device only. Pictures and GIFs both work.</small>
          <div class="profile-acts"><label class="btn small gold" style="cursor:pointer">${icon('user')} ${hasAvatar() ? 'Change picture' : 'Choose a picture'}<input type="file" accept="image/*" data-avatar hidden></label>${hasAvatar() ? '<button class="btn small" data-avatar-clear>Remove</button>' : ''}</div></div></div>
      ${group('', `<label class="set-row"><div><b>Name</b><small>Used for your greeting on Home.</small></div><input class="inp" data-set="profile.name" value="${esc(settings.profile.name)}" placeholder="${esc(settings.servers.jellyfin?.name || 'Your name')}" maxlength="32"></label>`)}`)}
    ${pane('look', 'Appearance', 'Light or dark, and the colours of the moving background.', `
      ${group('Theme', `<div class="themes">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match my system']].map(([v, l]) => `<button class="theme-card ${settings.theme === v ? 'on' : ''}" data-theme-pick="${v}"><span class="tc ${v}"><i></i><i></i><i></i></span>${l}</button>`).join('')}</div>`)}
      ${group('Highlight and buttons', `<div class="accents">${ACCENTS.map(([k, l, h, b]) => `<button class="accent ${(settings.look.accent?.preset || 'zenith') === k && !settings.look.accent?.hl ? 'on' : ''}" data-accent="${k}"><span class="ac-btn" style="background:linear-gradient(135deg,${b[0]},${b[1]})"></span><span class="ac-dot" style="background:${h}"></span>${l}</button>`).join('')}</div>
        <div class="sky-picks" style="padding-bottom:8px">${[['hl', 'Highlight', accentNow().hl], ['b0', 'Button start', accentNow().btn[0]], ['b1', 'Button end', accentNow().btn[1]]].map(([k, l, v]) => `<label><input type="color" data-accent-pick="${k}" value="${v}">${l}</label>`).join('')}</div>`)}
      ${group('Background', `<div class="set-row" style="display:block;border:0;padding-top:0"><div><b>Palette</b><small>Pick one, or set your own four colours below.</small></div><div class="palettes">${PALETTES.map(([k, l, c]) => `<button class="pal ${settings.look.preset === k ? 'on' : ''}" data-sky-preset="${k}" title="${l}"><span style="background:radial-gradient(circle at 30% 30%,${c[3]},transparent 45%),radial-gradient(circle at 75% 70%,${c[2]},transparent 60%),linear-gradient(135deg,${c[1]},${c[0]})"></span>${l}</button>`).join('')}</div>
        <div class="sky-picks">${['Base', 'Cloud one', 'Cloud two', 'Light'].map((l, i) => `<label><input type="color" data-sky="${i}" value="${skyColors()[i]}">${l}</label>`).join('')}</div></div>`)}`)}
    ${pane('servers', 'Servers', "Each card is one server, yours or a friend's. Connect its Jellyfin, Kavita and request sites and everything shows up together, marked with where it's from.", `<div class="srv-cards">${groups.list().map(srvCard).join('')}
      <button class="srv-add" data-group-add>${icon('plus')}<b>Add another server</b><small>A friend's Jellyfin, Kavita or request site</small></button></div>`)}
    ${pane('playback', 'Playback', 'How videos play.', `
      ${group('Video', `<div class="set-row"><div><b>Direct play only</b><small>Original file and quality. No server transcoding or remuxing. Unsupported formats show an explanation.</small></div></div>
      ${desktop && /Win/i.test(navigator.platform) ? sw('playback.nativeAudio', 'Windows app audio', 'Plays decoded audio through Zenith so Discord can capture sound when sharing this app window. Changes apply to the next playback.') : ''}
      ${sw('playback.autoplayNext', 'Play the next episode automatically')}
      ${sw('playback.skipIntro', 'Skip intros automatically', 'Needs intro markers on the server (Jellyfin 10.10 or the Intro Skipper plugin).')}`)}
`)}
    ${pane('subs', 'Language and subtitles', 'Which audio you hear, when subtitles come on, and how they look.', `
      ${group('Languages', `<label class="set-row"><div><b>Audio language</b><small>Picked whenever a video has it, dubs included.</small></div><select data-set="playback.audioLang"><option value="default" ${p.audioLang === 'default' ? 'selected' : ''}>The video's default</option>${LANGS.map(([c, n]) => `<option value="${c}" ${p.audioLang === c ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="set-row"><div><b>Subtitles</b><small>${{ smart: "Turns on when the audio isn't in your subtitle language.", always: 'Always on, in your subtitle language.', forced: 'Only signs and lines in other languages.', off: 'Never on unless you turn them on.' }[p.subtitles] || ''}</small></div><select data-set="playback.subtitles">${[['smart', 'When I need them'], ['always', 'Always on'], ['forced', 'Signs and foreign lines only'], ['off', 'Off']].map(([v, l]) => `<option value="${v}" ${p.subtitles === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="set-row"><div><b>Subtitle language</b></div><select data-set="playback.subLang">${LANGS.map(([c, n]) => `<option value="${c}" ${p.subLang === c ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`)}
      ${group('Presets', `<div class="sub-presets">${SUB_PRESETS.map(([k, l, o]) => `<button class="sub-preset ${p.subPreset === k ? 'on' : ''}" data-subpreset="${k}"><span class="sp-scene" style="${esc(presetVars(o))}"><span class="pl-subs-in"><span>Hello there</span></span></span><span class="sp-name">${l}${p.subPreset === k ? icon('check') : ''}</span></button>`).join('')}</div>`)}
      ${group('Customize', `<div class="sub-preview" id="sub-preview"><div class="pl-subs"><div class="pl-subs-in"><span>This is how your subtitles will look.</span><br><span><i>Every change shows up here.</i></span></div></div></div>
        <h4 class="set-sub">Text</h4>
        ${range('Size', 'subtitleSize', 60, 200, 5)}
        <div class="set-row"><div><b>Colour</b></div><span class="sub-chips">${SUB_COLORS.map(([c, n]) => `<button class="sub-swatch ${p.subColor === c ? 'on' : ''}" data-subpick="subColor:${c}" title="${n}" style="background:${c}"></button>`).join('')}<label class="sub-swatch custom ${SUB_COLORS.some(([c]) => c === p.subColor) ? '' : 'on'}" title="Any colour"><input type="color" value="${p.subColor}" data-subcolor="subColor" hidden></label></span></div>
        ${range('Opacity', 'subOpacity', 30, 100, 5)}
        ${seg('Font', 'subFont', SUB_FONTS)}
        ${seg('Thickness', 'subWeight', SUB_WEIGHTS)}
        ${seg('Edge', 'subEdge', SUB_EDGES)}
        <h4 class="set-sub">Background</h4>
        ${seg('Style', 'subBg', SUB_BGS)}
        <div class="set-row"><div><b>Colour</b></div><span class="sub-chips">${SUB_BG_COLORS.map(([c, n]) => `<button class="sub-swatch ${p.subBgColor === c ? 'on' : ''}" data-subpick="subBgColor:${c}" title="${n}" style="background:${c}"></button>`).join('')}</span></div>
        ${range('Opacity', 'subBgOpacity', 0, 100, 5)}
        <h4 class="set-sub">Position</h4>
        ${range('Height from the bottom', 'subPos', 2, 25, 1)}
        <div class="set-row"><div><b>Start over</b><small>Back to the Zenith preset.</small></div><button class="btn small" data-subreset>Reset</button></div>`)}`)}
    ${pane('general', 'General', 'Home, covers and extras.', group('', `${sw('app.rewatch', 'Rewatching', 'Next up follows the episode you watched last, not the furthest one. Go back to S1 E1 while you are on S2 E5, and Next up and Home offer S1 E2, not S2 E6.')}
      ${sw('app.liveSky', 'Moving background', 'Turn off for the smoothest app on slower computers. The background stays as a still picture.')}
      ${sw('app.covers', 'Covers for each volume and episode', 'Shows every volume cover and an episode preview you can hover to play through. Off is a plain list.')}
<label class="set-row"><div><b>Open on</b></div><select data-set="app.startPage">${[['home', 'Home'], ['movies', 'Movies'], ['shows', 'Shows'], ['read', 'Read'], ['request', 'Request']].map(([v, l]) => `<option value="${v}" ${a.startPage === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
${sw('app.notify', 'Tell me when my requests are ready')}
      ${desktop ? sw('app.discord', 'Show what I watch on my Discord profile', 'Needs the Discord app open on this computer.') : ''}`))}
    ${pane('about', 'About', 'Version, shortcuts and starting over.', `
      ${group('', `<div class="set-row"><div><b>Version ${esc(info?.version || VERSION)}</b><small>${desktop ? (info?.selfUpdate ? 'Updates download and install by themselves.' : 'You will be told when a new version is out.') : 'Web version'}</small></div>${desktop ? '<button class="btn small" data-check-updates>Check now</button>' : ''}</div>`)}
      ${group('', (() => { const g = window.zenithGpu || 'Unknown'; const soft = /swiftshader|llvmpipe|software|basic render/i.test(g); return `<div class="set-row"><div><b>Graphics</b><small>${esc(g)}${soft ? '<br><span style="color:var(--bad)">Drawing on the processor, not the graphics card, so the app will feel slow. Update your graphics driver, or turn off Moving background in General.</span>' : ''}</small></div></div>`; })())}
      ${group('Keyboard', `<div class="keys">${keys.map(([k, l]) => `<div><kbd>${k}</kbd><span>${l}</span></div>`).join('')}</div>`)}
      ${group('', `<div class="set-row"><div><b>Start over</b><small>Signs out everywhere on this device</small></div><button class="btn small danger" data-reset>Reset</button></div>`)}`)}
    </div>
  </div>`;
});

// Downloads (desktop)
const jobs = new Map();
on('download', (job) => {
  if (!desktop) return;
  if (jobs.has(job.id) && !jobs.get(job.id).done && !jobs.get(job.id).error) return toast('Already downloading.');
  jobs.set(job.id, { ...job, got: 0, total: job.size, started: Date.now() });
  desktop.download({ id: job.id, url: job.url, name: job.name });
  toast(`Downloading ${job.name}`); paintDl();
});
desktop?.on((ch, d) => {
  if (ch === 'download') { const j = jobs.get(d.id); if (!j) return; Object.assign(j, d); if (d.error) toast(`Download failed: ${d.error}`, 'bad'); paintDl(); }
  if (ch === 'update') showUpdate(d);
});
function paintDl() {
  const active = [...jobs.values()].filter((j) => !j.done && !j.error).length;
  const b = $('[data-dl-badge]'); if (b) { if (active) b.dataset.n = active; else delete b.dataset.n; }
  if (location.hash.startsWith('#/downloads')) { const list = $('#dl-list'); if (list) list.innerHTML = dlRows(); }
}
const dlRows = () => [...jobs.values()].reverse().map((j) => `<div class="list-row" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${esc(j.name)}</b><small>${j.error ? esc(j.error) : j.done ? `Done · ${fmtBytes(j.total)}` : `${fmtBytes(j.got)}${j.total ? ` of ${fmtBytes(j.total)}` : ''}`}</small>${!j.done && !j.error ? `<div class="progress" style="margin-top:8px"><i style="width:${j.total ? Math.round((j.got / j.total) * 100) : 5}%"></i></div>` : ''}</div>${j.done ? `<button class="btn small" data-show-file="${esc(j.id)}">Show file</button>` : j.error ? '' : `<button class="btn small" data-cancel-dl="${esc(j.id)}">Cancel</button>`}</div>`).join('') || '<div class="empty"><h2>No downloads</h2><p>Use the download button on a movie or episode to keep it for offline viewing.</p></div>';
route('downloads', () => `<div class="page-head"><div><span class="kicker">Offline</span><h1>Downloads</h1><p>Saved to your Downloads folder, in Zenith.</p></div></div><div class="stack" id="dl-list">${dlRows()}</div>`);
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cancel-dl]'); if (c) desktop.cancelDownload(c.dataset.cancelDl);
  const s = e.target.closest('[data-show-file]'); if (s) desktop.showFile(jobs.get(s.dataset.showFile)?.file);
});

// Updates
function showUpdate(d) {
  const box = $('#update');
  if (d.state === 'error' || (d.state === 'downloading' && !d.version && box.hidden)) return;
  box.hidden = false;
  if (d.state === 'downloading') box.innerHTML = `<b>Updating Zenith${d.version ? ` to ${esc(d.version)}` : ''}</b><p>Downloading in the background${d.percent ? ` (${d.percent}%)` : ''}.</p><div class="progress"><i style="width:${d.percent || 3}%"></i></div>`;
  if (d.state === 'ready') box.innerHTML = `<b>Update ready</b><p>Version ${esc(d.version)} is downloaded. Restart to use it, or it installs next time you close Zenith.</p><div class="acts"><button class="btn gold small" data-upd="install">Restart now</button><button class="btn small" data-upd="later">Later</button></div>`;
  if (d.state === 'manual') box.innerHTML = `<b>New version: ${esc(d.version)}</b><p>Download it to update. Your settings stay.</p><div class="acts"><button class="btn gold small" data-upd="open" data-url="${esc(d.url)}">Download</button><button class="btn small" data-upd="later">Later</button></div>`;
}
document.addEventListener('click', (e) => {
  const u = e.target.closest('[data-upd]'); if (!u) return;
  if (u.dataset.upd === 'install') desktop.installUpdate();
  if (u.dataset.upd === 'open') desktop.open(u.dataset.url);
  $('#update').hidden = true;
});

on('rendered', () => { const pv = document.getElementById('sub-preview'); if (pv) applySubStyle(pv); });

export function applyTheme() {
  const t = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
  const root = document.documentElement;
  if (root.dataset.theme && root.dataset.theme !== t) { root.classList.add('glide'); clearTimeout(applyTheme.t); applyTheme.t = setTimeout(() => root.classList.remove('glide'), 1000); }
  root.dataset.theme = t;
  applyAccent();
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
