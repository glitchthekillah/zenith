// Starts the app: title bar, top bar, routes and global shortcuts.
import { $, $$, esc, icon, render, go, current, settings, save, desktop, on, toast, serverLoading } from './core.js';
import * as jf from './jellyfin.js';
import * as kv from './kavita.js';
import * as rq from './requests.js';
import './watch.js';
import './read.js';
import './request.js';
import { applyTheme, applySky, applyAccent } from './settings.js';
import { loadAvatar, avatarHtml } from './avatar.js';
import { migrate, migrateStyle } from './tracks.js';
import * as player from './player.js';
import { watch as watchBlurhash } from './blurhash.js';

applyTheme(); applySky(); applyAccent();
watchBlurhash();
document.body.classList.toggle('calm', settings.app.liveSky === false);
migrate(save); migrateStyle(save);
loadAvatar().then(() => { if (!$('#top').hidden) topBar(); });

// Desktop: our own title bar and window buttons
if (desktop) {
  document.body.classList.add('desktop');
  $('#titlebar').hidden = false;
  const paint = (s) => { $('[data-win=maximize]').innerHTML = `<svg viewBox="0 0 24 24"><path d="${s.maximized ? 'M8 8h11v11H8z M5 16V5h11' : 'M5 5h14v14H5z'}"/></svg>`; $('[data-win=pin]').classList.toggle('on', !!s.pinned); };
  $('#titlebar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-win]'); if (!b) return;
    const a = b.dataset.win;
    if (a === 'pin') { const on = !b.classList.contains('on'); paint(await desktop.win('pin', on)); toast(on ? 'Zenith stays on top of other windows' : 'Back to normal'); return; }
    paint((await desktop.win(a)) || {});
  });
  $('#titlebar').addEventListener('dblclick', async (e) => { if (!e.target.closest('.tb-buttons')) paint(await desktop.win('maximize')); });
  desktop.on((ch, d) => { if (ch === 'window' && 'maximized' in d) paint(d); });
  desktop.win('state').then((s) => s && paint(s));
}

// Pending server work lives outside the top bar, so updates never recreate navigation.
let serverLoadingTimer;
function paintServerLoading() {
  const pill = $('#server-loading');
  if (!pill) return;
  const state = serverLoading.current();
  const multiple = settings.groups.filter(g => Object.values(g.servers || {}).some(s => s?.url)).length > 1;
  pill.hidden = !multiple || !state.count || $('#top').hidden;
  $('[data-server-loading-text]', pill).textContent = `Loading ${state.count} server${state.count === 1 ? '' : 's'}`;
  pill.title = state.names.join(', ');
}
on('server-loading', () => { clearTimeout(serverLoadingTimer); serverLoadingTimer = setTimeout(paintServerLoading, 150); });

// Top bar
const NAV = [['home', 'home', 'Home'], ['movies', 'film', 'Movies'], ['shows', 'tv', 'Shows'], ['read', 'book', 'Read'], ['request', 'plus', 'Request']];
function topBar() {
  const name = settings.profile?.name || settings.servers.jellyfin?.name || settings.servers.kavita?.name || settings.servers.ask?.name || '?';
  const show = { movies: jf.ready(), shows: jf.ready(), read: kv.ready(), request: !!rq.provider(), home: true };
  $('#top').hidden = false;
  $('#top').innerHTML = `<a class="brand" href="#/home"><span class="orb"></span><b>zenith</b></a>
    <nav>${NAV.filter(([k]) => show[k]).map(([k, ic, l]) => `<a class="navlink" data-nav="${k}" href="#/${k}">${icon(ic)}<span>${l}</span></a>`).join('')}</nav>
    <form class="search" id="top-search" role="search"><div class="field">${icon('search')}<input name="q" placeholder="Search everything" autocomplete="off" aria-label="Search"></div></form>
    <div class="tools">${desktop ? `<a class="icon-btn dl-count" data-dl-badge href="#/downloads" title="Downloads">${icon('download')}</a>` : ''}
      <a class="icon-btn" href="#/settings" title="Settings">${icon('settings')}</a>
      <a class="me" href="#/settings" title="${esc(name)}" style="display:grid;place-items:center;text-decoration:none;overflow:hidden">${avatarHtml(name)}</a></div>`;
  paintNav();
  paintServerLoading();
}
function paintNav() {
  const { name } = current();
  const group = { item: 'home', library: 'home', series: 'read', 'request-item': 'request', 'request-search': 'request', requests: 'request' }[name] || name;
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === group));
}
on('route', paintNav);
on('servers', topBar);

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'top-search') return;
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) go(`/search/${encodeURIComponent(q)}`);
});
document.addEventListener('keydown', (e) => {
  if (player.isOpen() || $('#reader:not([hidden])')) return;
  if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); $('#top-search input')?.focus(); }
  if (e.key === 'Escape' && document.activeElement?.closest('#top-search')) document.activeElement.blur();
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-act=reload]')) render(); });
// Keep the scrolling container in view on page change
on('route', () => { $('#app').scrollTop = 0; });

// Start
const anyServer = jf.ready() || kv.ready() || rq.provider();
if (!anyServer && !/^#\/(settings|welcome)/.test(location.hash)) location.hash = '#/welcome';
if (anyServer || /^#\/settings/.test(location.hash)) topBar();
on('route', ({ name }) => { if (name !== 'welcome' && $('#top').hidden) topBar(); if (name === 'welcome') $('#top').hidden = true; });
render();

// Seerr and ask-site sign-ins are cookies that end when the app closes; check and ask again if needed
setTimeout(async () => {
  try {
    if (settings.servers.ask?.name) await (await import('./core.js')).http(settings.servers.ask.url + '/api/me');
  } catch (e) { if (e.status === 401) toast('Sign in to the request site again in settings.'); }
  try { if (settings.servers.seerr?.userId) await (await import('./seerr.js')).me(); } catch (e) { if (e.status === 401 || e.status === 403) toast('Sign in to Seerr again in settings.'); }
}, 4000);
