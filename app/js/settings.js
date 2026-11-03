// Settings, first-run setup, downloads and the update notice.
import { $, $$, esc, icon, route, go, render, settings, save, toast, desktop, cleanUrl, modal, confirmBox, fmtBytes, on, emit, VERSION } from './core.js';
import * as jf from './jellyfin.js';
import * as kv from './kavita.js';
import * as seerr from './seerr.js';
import * as rq from './requests.js';
import { avatarHtml, hasAvatar, pickAvatar, clearAvatar } from './avatar.js';

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
export function applySky() { const c = skyColors(); window.zenithSky?.set(c); const sky = document.querySelector('.sky'); if (sky && !document.body.classList.contains('liquid')) sky.style.background = c[0]; }
const SERVERS = [
  ['jellyfin', 'Jellyfin', 'Movies, shows and anime to watch.', 'Username'],
  ['kavita', 'Kavita', 'Books, manga and comics to read.', 'Username'],
  ['ask', 'Request site', 'An ask site (like zenith\'s) for movies, shows, books and manga.', 'Jellyfin username'],
  ['seerr', 'Seerr', 'Jellyseerr, Overseerr or Seerr for movie and show requests.', 'Jellyfin username'],
];
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
      if (kind === 'jellyfin') await jf.signIn(url, u, p);
      if (kind === 'kavita') await kv.signIn(url, u, p);
      if (kind === 'seerr') await seerr.signIn(url, u, p, f.local?.checked ? 'local' : 'jellyfin');
      if (kind === 'ask') await rq.askSignIn(url, u, p);
      toast('Connected', 'ok'); f.closest('dialog')?.close(); emit('servers'); render();
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
    try { await kv.signInWithWebsite(url); toast('Connected to Kavita', 'ok'); kw.closest('dialog').close(); emit('servers'); render(); }
    catch (ex) { err.textContent = ex.message; kw.disabled = false; kw.textContent = 'Sign in on the Kavita website'; }
    return;
  }
  const c = e.target.closest('[data-add]'); if (c) return connectDialog(c.dataset.add);
  const d = e.target.closest('[data-disconnect]');
  if (d) {
    const k = d.dataset.disconnect;
    if (!(await confirmBox(`Sign out of ${SERVERS.find((s) => s[0] === k)[1]}?`, 'Sign out'))) return;
    if (k === 'jellyfin') await jf.signOut(); if (k === 'kavita') kv.signOut(); if (k === 'seerr') await seerr.signOut(); if (k === 'ask') await rq.askSignOut();
    emit('servers'); render();
  }
  const pp = e.target.closest('[data-sky-preset]');
  if (pp) { settings.look = { preset: pp.dataset.skyPreset, colors: null }; save(); applySky(); $$('[data-sky-preset]').forEach((b) => b.classList.toggle('on', b === pp)); skyInputs(); }
  if (e.target.closest('[data-avatar-clear]')) return clearAvatar();
  const tb = e.target.closest('[data-tab]');
  if (tb) { setTab = tb.dataset.tab; $$('[data-tab]').forEach((b) => b.classList.toggle('on', b === tb)); $$('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== setTab; }); return; }
  const t = e.target.closest('[data-theme-pick]'); if (t) { settings.theme = t.dataset.themePick; save(); applyTheme(); $$('[data-theme-pick]').forEach((b) => b.classList.toggle('on', b === t)); }
  if (e.target.closest('[data-check-updates]')) { const r = await desktop?.checkUpdates(); toast(r?.self ? 'Checking for updates...' : 'Checked. You will be told here if a new version is out.'); }
  if (e.target.closest('[data-reset]')) { if (await confirmBox('Sign out of everything and forget all settings on this device?', 'Reset')) { localStorage.clear(); location.hash = ''; location.reload(); } }
  if (e.target.closest('[data-export]')) { const blob = new Blob([JSON.stringify({ ...settings, servers: Object.fromEntries(Object.entries(settings.servers).map(([k, v]) => [k, v ? { url: v.url } : null])) }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zenith-settings.json'; a.click(); }
});
const skyInputs = () => { const c = skyColors(); $$('[data-sky]').forEach((i) => { i.value = c[Number(i.dataset.sky)]; }); };
document.addEventListener('input', (e) => {
  const i = e.target.closest('[data-sky]'); if (!i) return;
  const c = [...skyColors()]; c[Number(i.dataset.sky)] = i.value;
  settings.look = { preset: 'custom', colors: c }; applySky(); $$('[data-sky-preset]').forEach((b) => b.classList.remove('on'));
});
document.addEventListener('change', async (e) => {
  if (e.target.closest('[data-sky]')) return save();
  const av = e.target.closest('[data-avatar]');
  if (av) { const f = av.files?.[0]; av.value = ''; if (f) pickAvatar(f); return; }
  const s = e.target.closest('[data-set]'); if (!s) return;
  const [group, key] = s.dataset.set.split('.');
  settings[group][key] = s.type === 'checkbox' ? s.checked : s.type === 'number' || s.dataset.num ? Number(s.value) : s.value;
  save(); toast('Saved', 'ok');
  if (group === 'profile') emit('servers');
});
function connectDialog(kind) {
  const [k, name, desc, user] = SERVERS.find((s) => s[0] === kind);
  const guess = settings.servers.jellyfin?.url || '';
  modal(`<h2>Connect ${esc(name)}</h2><p style="color:var(--mute);margin:0 0 16px">${esc(desc)}</p>
    <form data-connect="${k}" style="display:grid;gap:12px"><label class="lab">Address<div class="field">${icon('link')}<input name="url" placeholder="https://${k}.example.com" value="${k === 'jellyfin' ? esc(guess) : ''}" required></div></label>
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
  const tabs = [['profile', 'user', 'Profile'], ['look', 'sun', 'Appearance'], ['servers', 'link', 'Servers'], ['playback', 'play', 'Playback'], ['general', 'grid', 'General'], ['about', 'settings', 'About']];
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
      ${group('Background', `<div class="set-row" style="display:block;border:0;padding-top:0"><div><b>Palette</b><small>Pick one, or set your own four colours below.</small></div><div class="palettes">${PALETTES.map(([k, l, c]) => `<button class="pal ${settings.look.preset === k ? 'on' : ''}" data-sky-preset="${k}" title="${l}"><span style="background:radial-gradient(circle at 30% 30%,${c[3]},transparent 45%),radial-gradient(circle at 75% 70%,${c[2]},transparent 60%),linear-gradient(135deg,${c[1]},${c[0]})"></span>${l}</button>`).join('')}</div>
        <div class="sky-picks">${['Base', 'Cloud one', 'Cloud two', 'Light'].map((l, i) => `<label><input type="color" data-sky="${i}" value="${skyColors()[i]}">${l}</label>`).join('')}</div></div>`)}`)}
    ${pane('servers', 'Servers', 'Everything stays between this app and your servers.', group('', `${SERVERS.map(([k, name, desc]) => { const s = settings.servers[k]; return `<div class="set-row"><div><b>${esc(name)}</b><small>${connected(k) ? esc(`${s.name || 'Signed in'} on ${new URL(s.url).host}`) : esc(desc)}</small></div>${connected(k) ? `<button class="btn small" data-disconnect="${k}">Sign out</button>` : `<button class="btn small gold" data-add="${k}">Connect</button>`}</div>`; }).join('')}
      ${rq.provider() === 'ask' && seerr.ready() ? '<small class="hint">Both request servers are connected: the request site is used, since it covers books and manga too.</small>' : ''}`))}
    ${pane('playback', 'Playback', 'How videos play.', group('', `${sw('playback.directPlay', 'Play the original file when possible', 'Best quality and no work for the server. Turn off if videos stutter.')}
      <label class="set-row"><div><b>Default quality</b><small>Lower uses less internet.</small></div><select data-set="playback.maxBitrate" data-num="1">${[[0, 'Original'], [40e6, '1080p high'], [20e6, '1080p'], [8e6, '720p'], [4e6, '480p'], [1.5e6, 'Data saver']].map(([v, l]) => `<option value="${v}" ${p.maxBitrate === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="set-row"><div><b>Subtitles</b></div><select data-set="playback.subtitles">${[['auto', 'Only when needed'], ['always', 'Always on'], ['off', 'Off']].map(([v, l]) => `<option value="${v}" ${p.subtitles === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${sw('playback.autoplayNext', 'Play the next episode automatically')}
      ${sw('playback.skipIntro', 'Skip intros automatically', 'Needs intro markers on the server (Jellyfin 10.10 or the Intro Skipper plugin).')}`))}
    ${pane('general', 'General', 'Home, covers and extras.', group('', `${sw('app.covers', 'Covers for each volume and episode', 'Shows every volume cover and an episode preview you can hover to play through. Off is a plain list.')}
<label class="set-row"><div><b>Open on</b></div><select data-set="app.startPage">${[['home', 'Home'], ['movies', 'Movies'], ['shows', 'Shows'], ['read', 'Read'], ['request', 'Request']].map(([v, l]) => `<option value="${v}" ${a.startPage === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
${sw('app.notify', 'Tell me when my requests are ready')}
      ${desktop ? sw('app.discord', 'Show what I watch on my Discord profile', 'Needs the Discord app open on this computer.') : ''}`))}
    ${pane('about', 'About', 'Version, shortcuts and starting over.', `
      ${group('', `<div class="set-row"><div><b>Version ${esc(info?.version || VERSION)}</b><small>${desktop ? (info?.selfUpdate ? 'Updates download and install by themselves.' : 'You will be told when a new version is out.') : 'Web version'}</small></div>${desktop ? '<button class="btn small" data-check-updates>Check now</button>' : ''}</div>`)}
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

export function applyTheme() {
  const t = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
  document.documentElement.dataset.theme = t;
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
