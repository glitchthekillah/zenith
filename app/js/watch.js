// Watch pages: home, libraries, a title's page, people and search.
import { defer, $, $$, esc, icon, route, go, settings, fmtRuntime, plural, loading, errorBox, toast, desktop, emit, on, debounce, groups, gsuf, splitId } from './core.js';
import * as jf from './jellyfin.js';
import * as player from './player.js';
import * as kv from './kavita.js';
import * as rq from './requests.js';
import { avatarHtml } from './avatar.js';

const cache = new Map(); // id -> item, so clicks know what they opened
const remember = (list) => { for (const it of list || []) cache.set(it.Id, it); return list; };
export const known = (id) => cache.get(id);
// Ask every connected server (each group) and tag the results with where they came from
const fromAll = async (kind, fn) => (await Promise.all(groups.with(kind).map((g) => Promise.resolve().then(() => groups.run(g, fn)).then((x) => groups.tag(g, Array.isArray(x) ? x : x?.Items || [])).catch(() => [])))).flat();
const inGroup = (x, fn) => (x?._g ? groups.run(groups.byId(x._g), fn) : fn());
const fromPill = (x, kind = 'jellyfin') => { if (!x?._g || !groups.many(kind)) return ''; const n = x._copies?.length > 1 ? placeNames(x) : [groups.nameOf(groups.byId(x._g))]; return `<span class="from-pill${n.length > 1 ? ' multi' : ''}">${n.length > 1 ? `on ${esc(n.join(' + '))}` : `from ${esc(n[0])}`}</span>`; };
const recent = (a, b) => Date.parse(b.UserData?.LastPlayedDate || 0) - Date.parse(a.UserData?.LastPlayedDate || 0);

// ── The same title on more than one server ────────────────────────────
// Matched by the database IDs Jellyfin keeps (TMDB, IMDb, TVDB), never by name.
const pid = (x, ...keys) => { const p = x?.ProviderIds || {}; for (const k of keys) { const v = p[k] || p[k[0].toUpperCase() + k.slice(1)]; if (v) return `${k}:${v}`; } return ''; };
const showKey = (x) => pid(x, 'Tvdb', 'Tmdb', 'Imdb');
export function titleKey(x) {
  if (!x) return '';
  if (x.Type === 'Movie') return pid(x, 'Tmdb', 'Imdb') && 'm|' + pid(x, 'Tmdb', 'Imdb');
  if (x.Type === 'Series') return showKey(x) && 's|' + showKey(x);
  if (x.Type === 'Episode') return x.SeriesName && x.ParentIndexNumber != null && x.IndexNumber != null ? `e|${x.SeriesName.toLowerCase()}|${x.ParentIndexNumber}|${x.IndexNumber}` : '';
  return '';
}
const order = (x) => settings.groups.findIndex((g) => g.id === x._g);
const progressOf = (x) => Date.parse(x.UserData?.LastPlayedDate || 0) || 0;
// Keep one card per title: the copy you watched most recently, else the one on your own (first) server.
// Every copy is kept on it as _copies so the info page can offer them.
function mergeShows(list) {
  const out = [], seen = new Set();
  for (const x of list || []) { const k = x.SeriesName ? 'show|' + x.SeriesName.toLowerCase() : ''; if (k && seen.has(k)) continue; if (k) seen.add(k); out.push(x); }
  return out;
}
export function merge(list) {
  const out = [], seen = new Map();
  for (const x of list || []) {
    const k = titleKey(x);
    if (!k) { out.push(x); continue; }
    const at = seen.get(k);
    if (at == null) { x._copies = [x]; seen.set(k, out.length); out.push(x); continue; }
    const cur = out[at], copies = [...cur._copies, x];
    const best = copies.slice().sort((a, b) => progressOf(b) - progressOf(a) || order(a) - order(b))[0];
    best._copies = copies; out[at] = best;
  }
  return out;
}
const placeNames = (x) => [...new Set((x._copies || [x]).map((c) => groups.nameOf(groups.byId(c._g))))];

// ── Cards ───────────────────────────────────────────────────────────────
// Posters: episodes and seasons show their show's poster and name (episode stills look
// like random screenshots in a poster grid). Wide cards keep the episode's own picture.
const seriesPoster = (it, w) => it.SeriesPrimaryImageTag ? `${(it._g && groups.byId(it._g)?.servers.jellyfin || settings.servers.jellyfin || groups.srv('jellyfin')).url}/Items/${it.SeriesId}/Images/Primary?tag=${it.SeriesPrimaryImageTag}&maxWidth=${w}&quality=88` : '';
export function card(it, { wide = false, badge = '', asShow = false } = {}) {
  const ep = it.Type === 'Episode', season = it.Type === 'Season';
  const pic = wide ? jf.img(it, 'Thumb', 480) : ep ? seriesPoster(it, 300) || jf.img(it, 'Primary', 300) : season ? jf.img(it, 'Primary', 300) || seriesPoster(it, 300) : jf.img(it, 'Primary', 300);
  const pct = it.UserData?.PlayedPercentage;
  const epCode = ep ? `S${it.ParentIndexNumber ?? '?'} E${it.IndexNumber ?? '?'}` : '';
  const sub = asShow && ep ? `Latest: ${epCode}` : asShow && season ? `Latest: ${it.Name}` : ep ? (wide ? `${epCode} · ${it.Name}` : epCode) : season ? it.Name : it.Type === 'Series' ? [it.ProductionYear, it.Status === 'Continuing' ? 'Ongoing' : ''].filter(Boolean).join(' · ') : it.ProductionYear || '';
  const title = ep || season ? it.SeriesName || it.Name : it.Name;
  // asShow: a "new episode" card opens and plays the show (from where you are, or episode 1 if you never started)
  const href = asShow && it.SeriesId ? `#/item/${it.SeriesId}${gsuf(it)}` : season ? `#/item/${it.SeriesId}${gsuf(it)}/${it.Id}` : `#/item/${it.Id}${gsuf(it)}`;
  const playId = asShow && it.SeriesId ? it.SeriesId : it.Id;
  const unplayed = it.UserData?.UnplayedItemCount;
  return `<a class="card" href="${href}" data-id="${it.Id}">
    <div class="art${wide ? ' wide' : ''}">${pic ? `<img loading="lazy" src="${esc(pic)}" alt="">` : `<div class="ph">${esc(title)}</div>`}
      ${badge ? `<span class="badge amber">${esc(badge)}</span>` : ''}
      ${it.UserData?.Played ? `<span class="check">${icon('check')}</span>` : unplayed ? `<span class="badge right pink">${unplayed}</span>` : ''}
      ${pct ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}${fromPill(it)}
      ${['Movie', 'Episode'].includes(it.Type) || asShow ? `<span class="play-over"><span data-play="${playId}" title="Play">${icon('play')}</span></span>` : ''}
    </div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</a>`;
}
// "New in" rows: one card per show, however many new episodes or seasons it got
function newCards(items) {
  const seen = new Set(), out = [];
  for (const it of items) {
    const key = it.SeriesId || it.Id;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = items.filter((x) => (x.SeriesId || x.Id) === key && x.Type === 'Episode').length;
    out.push(card(it, { asShow: ['Episode', 'Season'].includes(it.Type), badge: it.Type === 'Episode' ? (count > 1 ? `${count} new episodes` : 'New episode') : it.Type === 'Season' ? 'New season' : '' }));
  }
  return out.join('');
}
export const shelf = (title, html, link = '', wide = false) => html ? `<section class="row"><div class="row-head"><h3>${esc(title)}</h3>${link ? `<a href="${link}">See all</a>` : ''}</div><div class="shelf"><button class="arrow l" data-scroll="-1" aria-label="Scroll left">${icon('back')}</button><div class="strip${wide ? ' wide' : ''}">${html}</div><button class="arrow r" data-scroll="1" aria-label="Scroll right">${icon('next')}</button></div></section>` : '';

// ── Home ────────────────────────────────────────────────────────────────
route('home', () => defer(async (publish, alive) => {
  const parts = new Map();
  const tasks = [];
  const stats = { resume: 0, next: 0, read: 0, ready: 0 };
  let resumeTop = null, shuffle = [];
  const paint = () => publish(greeting(stats, resumeTop, shuffle), 0);
  const add = (order, html) => { if (alive()) { parts.set(order, html); publish(html, order); paint(); } };
  if (jf.ready()) {
    // Each server contributes as soon as it answers; no all-servers barrier.
    const stream = (fn, update) => {
      const results = new Map();
      return Promise.all(groups.with('jellyfin').map(async (g) => {
        const list = await Promise.resolve(groups.run(g, fn)).catch(() => []);
        if (!alive()) return;
        results.set(g.id, groups.tag(g, Array.isArray(list) ? list : list?.Items || []));
        update([...results.values()].flat());
      }));
    };
    let becauseId = '';
    tasks.push(stream(() => jf.resume(20), (list) => {
      const resume = remember(merge(list.sort(recent)).slice(0, 24));
      stats.resume = resume.length; resumeTop = resume[0] || resumeTop;
      add(2, shelf('Continue watching', resume.map((i) => card(i, { wide: true })).join(''), '', true));
      const seed = resume[0];
      if (seed && !becauseId) {
        becauseId = seed.SeriesId || seed.Id;
        const owner = groups.byId(seed._g);
        groups.run(owner, () => jf.similar(becauseId)).then((items) => {
          remember(groups.tag(owner, items));
          add(6, shelf(`Because you watched ${seed.SeriesName || seed.Name}`, items.map((i) => card(i)).join('')));
        }).catch(() => {});
      }
    }));
    tasks.push(stream(() => jf.nextUp(20), (list) => {
      const next = remember(mergeShows(list.sort(recent)).slice(0, 24));
      stats.next = next.length; resumeTop ||= next[0];
      add(4, shelf('Next up', next.map((i) => card(i, { wide: true })).join(''), '', true));
    }));
    tasks.push(stream(() => jf.items({ types: 'Movie,Series', sort: 'Random', filters: 'IsUnplayed', limit: 18 }), (list) => {
      shuffle = remember(merge(list).slice(0, 24));
      add(5, shelf('Picked for you', shuffle.map((i) => card(i)).join('')));
    }));
    tasks.push(stream(() => jf.items({ types: 'Movie,Series', sort: 'CommunityRating', order: 'Descending', limit: 18 }), (list) => {
      const top = remember(merge(list).sort((a, b) => (b.CommunityRating || 0) - (a.CommunityRating || 0)).slice(0, 24));
      add(15, shelf(groups.many('jellyfin') ? 'Top rated on your servers' : 'Top rated on your server', top.filter((i) => i.CommunityRating).map((i) => card(i, { badge: i.CommunityRating.toFixed(1) })).join('')));
    }));
    const libraries = new Map(), latest = new Map(), rowOrders = new Map();
    tasks.push(...groups.with('jellyfin').map(async (owner) => {
      const views = await groups.run(owner, () => jf.views()).catch(() => []);
      if (!alive()) return;
      const libs = groups.tag(owner, views.filter((v) => ['movies', 'tvshows', 'boxsets', 'homevideos', 'mixed', undefined].includes(v.CollectionType)));
      libraries.set(owner.id, libs);
      const allLibs = [...libraries.values()].flat();
      add(3, allLibs.length ? `<section class="row"><div class="row-head"><h3>Your libraries</h3></div><div class="libtiles">${allLibs.map((v) => `<a class="libtile" href="#/library/${v.Id}${gsuf(v)}">${jf.img(v, 'Primary', 600) ? `<img loading="lazy" src="${esc(jf.img(v, 'Primary', 600))}" alt="">` : ''}<span>${esc(v.Name)}${groups.many('jellyfin') ? `<small>${esc(groups.nameOf(groups.byId(v._g)))}</small>` : ''}</span></a>`).join('')}</div></section>` : '');
      await Promise.all(libs.slice(0, 8).map(async (v) => {
        const items = remember(groups.tag(owner, await groups.run(owner, () => jf.latest(v.Id, 18)).catch(() => [])));
        if (!alive()) return;
        latest.set(`${owner.id}:${v.Id}`, { v, items });
        const rows = new Map();
        for (const x of latest.values()) {
          const key = `${x.v.CollectionType}|${String(x.v.Name).toLowerCase()}`;
          if (!rowOrders.has(key)) rowOrders.set(key, 7 + rowOrders.size / 1000);
          if (rows.has(key)) rows.get(key).items.push(...x.items); else rows.set(key, { v: x.v, items: [...x.items] });
        }
        for (const [key, x] of rows) add(rowOrders.get(key), shelf(`New in ${x.v.Name}`, newCards(merge(x.items)), `#/library/${x.v.Id}${gsuf(x.v)}`));
        const pool = [...latest.values()].flatMap((x) => x.items).filter((i) => i.BackdropImageTags?.length && i.Overview).slice(0, 6);
        if (pool.length) add(1, hero(pool));
      }));
    }));
  }
  if (groups.with('kavita').length) tasks.push((async () => {
    const [deck, fresh] = await Promise.all([fromAll('kavita', () => kv.onDeck()), fromAll('kavita', () => kv.recent())]);
    stats.read = (deck || []).length;
    add(20, shelf('Keep reading', (deck || []).map(readCard).join(''), '#/read'));
    add(21, shelf('New to read', (fresh || []).map(readCard).join(''), '#/read'));
  })().catch(() => {}));
  if (rq.provider()) tasks.push((async () => {
    const [d, mine] = await Promise.all([rq.discover('trending'), rq.mine().catch(() => [])]);
    const list = (Array.isArray(mine) ? mine : mine?.items || []).map((x) => ({ ...x, status: x.status || x.state })).slice(0, 20);
    stats.ready = list.filter((x) => x.status === 'available').length;
    add(29, shelf('Your requests', list.map(requestCard).join(''), '#/request'));
    add(30, shelf('Trending to request', (d.items || []).slice(0, 20).map(requestCard).join(''), '#/request'));
  })().catch(() => {}));
  await Promise.all(tasks);
  if (![...parts.values()].some(Boolean)) return `<div class="empty"><h2>Nothing here yet</h2><p>Connect a server in settings to fill this page.</p><a class="btn gold" href="#/settings">Open settings</a></div>`;
  paint();
}, loading(12)));
// The top of Home: your picture, a greeting, a few numbers and quick buttons
function greeting(st, resumeTop, shuffle) {
  const h = new Date().getHours();
  const hi = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = settings.profile?.name || settings.servers.jellyfin?.name || settings.servers.kavita?.name || '';
  const chips = [[st.resume, 'in progress', '#/home'], [st.next, 'up next', '#/shows'], [st.read, 'to keep reading', '#/read'], [st.ready, st.ready === 1 ? 'request ready' : 'requests ready', '#/request']].filter(([n]) => n);
  const pick = shuffle.length ? shuffle[Math.floor(Math.random() * shuffle.length)] : null;
  return `<section class="hello"><a class="hello-pic" href="#/settings" title="Change your picture">${avatarHtml(name || '?')}</a>
    <div class="hello-text"><span class="kicker">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</span><h1>${hi}${name ? `, <em>${esc(name)}</em>` : ''}</h1>
      ${chips.length ? `<div class="hello-stats">${chips.map(([n, l, href]) => `<a href="${href}"><b>${n}</b>${esc(l)}</a>`).join('')}</div>` : ''}</div>
    <div class="hello-acts">${resumeTop ? `<button class="btn gold" data-play="${resumeTop.Id}">${icon('play')} Resume ${esc(resumeTop.SeriesName || resumeTop.Name)}</button>` : ''}${pick ? `<button class="btn" data-play="${pick.Type === 'Series' ? pick.Id : pick.Id}" title="${esc(pick.Name)}">${icon('shuffle')} Surprise me</button>` : ''}</div></section>`;
}
function hero(list) {
  if (!list.length) return '';
  const slides = list.map((it, i) => `<div class="hero-slide" data-i="${i}" ${i ? 'hidden' : ''}><img src="${esc(jf.img(it, 'Backdrop', 1600))}" alt=""><div class="hero-in"><span class="kicker">New on ${esc(settings.servers.jellyfin.server || 'your server')}</span><h2>${esc(it.Type === 'Episode' ? it.SeriesName : it.Name)}</h2><div class="meta">${[it.ProductionYear, it.OfficialRating, fmtRuntime(it.RunTimeTicks), it.CommunityRating ? `${it.CommunityRating.toFixed(1)} rating` : '', (it.Genres || []).slice(0, 2).join(', ')].filter(Boolean).map(esc).join('<span>·</span>')}</div><p>${esc(it.Overview)}</p><div class="acts"><button class="btn gold big" data-play="${it.SeriesId || it.Id}">${icon('play')} Play</button><a class="btn big" href="#/item/${it.SeriesId || it.Id}">More info</a></div></div></div>`).join('');
  return `<section class="hero" id="hero">${slides}<div class="hero-dots">${list.map((_, i) => `<button data-hero="${i}" class="${i ? '' : 'on'}" aria-label="Slide ${i + 1}"></button>`).join('')}</div></section>`;
}
let heroTimer;
on('rendered', () => {
  clearInterval(heroTimer);
  const h = $('#hero'); if (!h) return;
  const slides = $$('.hero-slide', h);
  if (slides.length < 2) return;
  let i = 0;
  const show = (n) => { i = (n + slides.length) % slides.length; slides.forEach((s, k) => { s.hidden = k !== i; }); $$('[data-hero]', h).forEach((b, k) => b.classList.toggle('on', k === i)); };
  h.onclick = (e) => { const b = e.target.closest('[data-hero]'); if (b) { show(Number(b.dataset.hero)); clearInterval(heroTimer); } };
  heroTimer = setInterval(() => { if (!document.hidden && !player.isOpen()) show(i + 1); }, 9000);
});
const hs = document.createElement('style'); hs.textContent = '.hero-slide{position:absolute;inset:0;display:flex;align-items:flex-end}.hero-slide img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:heroin .8s ease both}.hero-slide::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,7,13,.95) 0,rgba(7,7,13,.6) 45%,transparent 75%),linear-gradient(0deg,rgba(7,7,13,.9),transparent 55%)}.hero-slide .hero-in{z-index:1}.hero::after{display:none}@keyframes heroin{from{opacity:0;transform:scale(1.04)}}'; document.head.append(hs);

export const readCard = (s) => `<a class="card" href="#/series/${s.id}${gsuf(s)}"><div class="art"><img loading="lazy" src="${esc(kv.cover(s.id, s._g))}" alt="">${fromPill(s, 'kavita')}${s.pagesRead && s.pages ? `<span class="bar"><i style="width:${Math.round((s.pagesRead / s.pages) * 100)}%"></i></span>` : ''}</div><b>${esc(s.name)}</b>${s.libraryName ? `<small>${esc(s.libraryName)}</small>` : ''}</a>`;
export const requestCard = (x) => `<a class="card" href="#/request-item/${x.type}/${encodeURIComponent(x.id ?? x.key)}" data-key="${esc(x.key)}"><div class="art">${x.poster ? `<img loading="lazy" src="${esc(x.poster)}" alt="">` : `<div class="ph">${esc(x.title)}</div>`}${x.status && x.status !== 'none' ? `<span class="badge ${x.status === 'available' ? 'ok' : 'amber'}">${esc(rq.STATUS[x.status] || x.status)}</span>` : ''}</div><b>${esc(x.title)}</b><small>${esc([x.year, x.author, x.type === 'tv' ? (x.anime ? 'Anime' : 'Show') : x.type === 'movie' ? 'Movie' : x.type].filter(Boolean).join(' · '))}</small></a>`;

// ── Libraries ───────────────────────────────────────────────────────────
const SORTS = [['SortName', 'Name'], ['DateCreated', 'Recently added'], ['PremiereDate', 'Release date'], ['CommunityRating', 'Rating'], ['DatePlayed', 'Recently watched'], ['Random', 'Random']];
const libState = {};
route('movies', () => libraryPage(null, 'Movie', 'Movies'));
route('shows', () => libraryPage(null, 'Series', 'Shows'));
route('library', async (id) => {
  id = splitId(id);
  const v = (await jf.views()).find((x) => x.Id === id);
  const type = v?.CollectionType === 'movies' ? 'Movie' : v?.CollectionType === 'tvshows' ? 'Series' : v?.CollectionType === 'boxsets' ? 'BoxSet' : '';
  return libraryPage(id, type, v?.Name || 'Library');
});
async function libraryPage(parentId, type, title) {
  if (!jf.ready()) return needServer('Jellyfin');
  const key = parentId || type;
  const st = (libState[key] ||= { sort: 'SortName', order: 'Ascending', filter: '', genre: '', start: 0 });
  const owner = groups.active();
  const genreSelect = (genres) => `<select data-lib-genre aria-label="Genre"><option value="">All genres</option>${genres.map((g) => `<option ${st.genre === g.Name ? 'selected' : ''}>${esc(g.Name)}</option>`).join('')}</select>`;
  const genreMenu = defer(async () => genreSelect(await groups.run(owner, () => jf.genres(parentId || '')).catch(() => [])), genreSelect([]));
  const loadGrid = defer(() => groups.run(owner, () => fillLibrary(parentId, type, st, true)));
  return `<div class="page-head"><div><span class="kicker">Library</span><h1>${esc(title)}</h1></div><p id="lib-count"></p></div>
    <div class="toolbar">
      <div class="chips" style="margin:0">${[['', 'All'], ['IsUnplayed', 'Not watched'], ['IsResumable', 'In progress'], ['IsFavorite', 'Favorites'], ['IsPlayed', 'Watched']].map(([f, l]) => `<button class="chip ${st.filter === f ? 'on' : ''}" data-lib-filter="${f}">${l}</button>`).join('')}</div>
      <span class="grow"></span>
      ${genreMenu}
      <select data-lib-sort aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="icon-btn" data-lib-order title="Reverse order">${icon(st.order === 'Ascending' ? 'next' : 'back')}</button>
      <button class="btn" data-shuffle="${esc(parentId || '')}" data-type="${type}">${icon('shuffle')} Shuffle</button>
    </div>
    <div class="grid" id="lib-grid" data-parent="${esc(parentId || '')}" data-type="${type}" data-key="${esc(key)}">${loading(18)}</div>
    <div id="lib-more" style="height:40px"></div>${loadGrid}`;
}
async function fillLibrary(parentId, type, st, reset) {
  const grid = $('#lib-grid'); if (!grid || (grid.dataset.busy && !reset)) return;
  const request = {}; grid.loadRequest = request; grid.dataset.busy = '1';
  const current = () => grid.isConnected && grid.loadRequest === request;
  if (reset) st.start = 0;
  const q = { parentId: parentId || '', types: type || '', sort: st.sort === 'Random' ? 'Random' : `${st.sort},SortName`, order: st.order, start: st.start, limit: 60, filters: st.filter, genres: st.genre, recursive: true };
  if (st.sort !== 'SortName' && st.sort !== 'Random' && reset) q.order = st.order === 'Ascending' && ['DateCreated', 'PremiereDate', 'CommunityRating', 'DatePlayed'].includes(st.sort) ? 'Descending' : st.order;
  try {
    const gs = groups.with('jellyfin');
    let r;
    if (!parentId && gs.length > 1) {
      if (reset) { st.starts = {}; st.totals = {}; st.seenKeys = new Set(); }
      const parts = [], before = reset ? '' : grid.innerHTML, seen = new Set(st.seenKeys || []);
      const paint = (finished = false) => {
        if (!current()) return;
        let items = merge(parts.flatMap((p) => p.Items).filter((x) => reset || !seen.has(titleKey(x))));
        if (st.sort === 'SortName') items.sort((a, b) => (a.SortName || a.Name).localeCompare(b.SortName || b.Name) * (st.order === 'Ascending' ? 1 : -1));
        remember(items);
        const html = items.map((i) => card(i)).join('');
        if (html || finished) grid.innerHTML = before + html || '<div class="empty" style="grid-column:1/-1"><h2>Nothing matches</h2><p>Try another filter.</p></div>';
        const c = $('#lib-count'); if (c) c.textContent = plural(Object.values(st.totals).reduce((n, x) => n + x, 0), 'title') + (finished ? '' : ' · Loading other servers…');
        if (finished) { for (const x of items) st.seenKeys.add(titleKey(x)); grid.dataset.done = gs.every((g) => (st.starts[g.id] || 0) >= (st.totals[g.id] || 0)) ? '1' : ''; }
      };
      await Promise.all(gs.map(async (g) => {
        const page = st.starts[g.id] || 0;
        let data = { Items: [], TotalRecordCount: st.totals[g.id] || 0 };
        if (st.totals[g.id] == null || page < st.totals[g.id]) data = await Promise.resolve(groups.run(g, () => jf.items({ ...q, start: page, limit: 40 }))).catch(() => data);
        if (!current()) return;
        groups.tag(g, data.Items); parts.push({ g, ...data });
        st.starts[g.id] = page + data.Items.length; st.totals[g.id] = data.TotalRecordCount;
        paint();
      }));
      paint(true);
      return;
    }
    r = await jf.items(q);
    if (!current()) return;
    remember(r.Items);
    const html = r.Items.map((i) => card(i)).join('');
    if (reset) grid.innerHTML = html || '<div class="empty" style="grid-column:1/-1"><h2>Nothing matches</h2><p>Try another filter.</p></div>'; else grid.insertAdjacentHTML('beforeend', html);
    st.start += r.Items.length; st.total = r.TotalRecordCount;
    const c = $('#lib-count'); if (c) c.textContent = plural(r.TotalRecordCount, 'title');
    grid.dataset.done = st.start >= r.TotalRecordCount ? '1' : '';
  } catch (e) { if (current()) grid.innerHTML = errorBox(e); }
  finally { if (current()) delete grid.dataset.busy; }
}
// Infinite scroll for libraries
document.addEventListener('scroll', debounce(() => {
  const more = $('#lib-more'), grid = $('#lib-grid');
  if (!more || !grid || grid.dataset.done || grid.dataset.busy) return;
  if (more.getBoundingClientRect().top < innerHeight + 600) {
    fillLibrary(grid.dataset.parent || null, grid.dataset.type, libState[grid.dataset.key], false);
  }
}, 120), true);
document.addEventListener('change', (e) => {
  const grid = $('#lib-grid'); if (!grid) return;
  const st = libState[grid.dataset.key];
  if (e.target.matches('[data-lib-sort]')) { st.sort = e.target.value; fillLibrary(grid.dataset.parent || null, grid.dataset.type, st, true); }
  if (e.target.matches('[data-lib-genre]')) { st.genre = e.target.value; fillLibrary(grid.dataset.parent || null, grid.dataset.type, st, true); }
});
document.addEventListener('click', async (e) => {
  const grid = $('#lib-grid');
  const f = e.target.closest('[data-lib-filter]');
  if (f && grid) { const st = libState[grid.dataset.key]; st.filter = f.dataset.libFilter; $$('[data-lib-filter]').forEach((b) => b.classList.toggle('on', b === f)); return fillLibrary(grid.dataset.parent || null, grid.dataset.type, st, true); }
  if (e.target.closest('[data-lib-order]') && grid) { const st = libState[grid.dataset.key]; st.order = st.order === 'Ascending' ? 'Descending' : 'Ascending'; e.target.closest('[data-lib-order]').innerHTML = icon(st.order === 'Ascending' ? 'next' : 'back'); return fillLibrary(grid.dataset.parent || null, grid.dataset.type, st, true); }
  const sh = e.target.closest('[data-shuffle]');
  if (sh) {
    const type = sh.dataset.type === 'Series' ? 'Episode' : sh.dataset.type || 'Movie,Episode';
    const r = await jf.items({ parentId: sh.dataset.shuffle, types: type, sort: 'Random', limit: 1, filters: 'IsUnplayed' }).catch(() => null);
    const it = r?.Items?.[0] || (await jf.items({ parentId: sh.dataset.shuffle, types: type, sort: 'Random', limit: 1 }).catch(() => null))?.Items?.[0];
    if (it) player.play(it); else toast('Nothing to shuffle here.');
  }
});

// ── A title's page ─────────────────────────────────────────────────────
route('item', async (id, seasonId) => {
  id = splitId(id);
  if (!jf.ready()) return needServer('Jellyfin');
  const owner = groups.active();
  const it = await jf.item(id);
  it._g = owner.id;
  cache.set(id, it);
  if (it.Type === 'Season') return go(`/item/${it.SeriesId}/${it.Id}`);
  if (it.Type === 'Person') return personPage(it);
  const back = jf.img(it, 'Backdrop', 1920);
  const facts = [it.ProductionYear, it.OfficialRating ? `<span class="pill">${esc(it.OfficialRating)}</span>` : '', fmtRuntime(it.RunTimeTicks), it.CommunityRating ? `<span class="star">${icon('star')} ${it.CommunityRating.toFixed(1)}</span>` : '', (it.Genres || []).slice(0, 3).join(', '), it.Type === 'Series' && it.Status ? (it.Status === 'Continuing' ? 'Ongoing' : 'Ended') : ''].filter(Boolean);
  const ep = it.Type === 'Episode';
  const people = (it.People || []).filter((p) => ['Actor', 'Director', 'Writer'].includes(p.Type)).slice(0, 24);
  const where = ['Movie', 'Series'].includes(it.Type) ? defer(() => copiesBlock(it, owner)) : '';
  const html = `<div class="detail">${back ? `<div class="backdrop"><img src="${esc(back)}" alt=""></div>` : ''}
  <div class="detail-in${it.Type === 'Episode' ? ' ep-detail' : ''}"><div class="art${it.Type === 'Episode' ? ' wide' : ''}">${jf.img(it, it.Type === 'Episode' ? 'Thumb' : 'Primary', it.Type === 'Episode' ? 840 : 500) ? `<img src="${esc(jf.img(it, it.Type === 'Episode' ? 'Thumb' : 'Primary', it.Type === 'Episode' ? 840 : 500))}" alt="">` : `<div class="ph">${esc(it.Name)}</div>`}</div>
  <div>
    ${ep ? `<a class="kicker" href="#/item/${it.SeriesId}" style="text-decoration:none">${esc(it.SeriesName)} · S${it.ParentIndexNumber} E${it.IndexNumber}</a>` : `<span class="kicker">${esc(it.Type === 'Series' ? 'Show' : it.Type === 'BoxSet' ? 'Collection' : it.Type)}</span>`}
    <h1>${esc(it.Name)}</h1>${it.Taglines?.[0] ? `<p class="tagline">${esc(it.Taglines[0])}</p>` : ''}
    <div class="facts">${facts.join('<span>·</span>')}</div>
    <p class="overview">${esc(it.Overview || '')}</p>
    ${where}
    ${it.Type === 'Series' ? defer((_publish, alive) => titleControls(it, owner, alive), '<p class="mute">Loading playback options…</p>') : await titleControls(it, owner)}
  </div></div></div>
  ${it.Type === 'Series' ? defer(() => seasonsBlock(it, seasonId, owner), loading(3)) : ''}
  ${it.Type === 'BoxSet' ? defer(() => groups.run(owner, () => boxsetBlock(it))) : ''}
  ${people.length ? `<section class="row"><div class="row-head"><h3>Cast and crew</h3></div><div class="people">${people.map((p) => `<a class="person" href="#/item/${p.Id}" style="text-decoration:none"><div class="face">${jf.personImg(p) ? `<img loading="lazy" src="${esc(jf.personImg(p))}" alt="">` : ''}</div><b>${esc(p.Name)}</b>${esc(p.Role || p.Type)}</a>`).join('')}</div></section>` : ''}
  ${defer(async () => shelf('More like this', remember(groups.tag(owner, await groups.run(owner, () => jf.similar(id)).catch(() => []))).map((i) => card(i)).join('')))}`;
  return html;
});
async function titleControls(it, owner, alive = () => true) {
  let resumeLabel = 'Play';
  let playId = it.Id;
  if (it.Type === 'Series') {
    const next = await groups.run(owner, () => startEpisode(it.Id)).catch(() => null);
    if (next) { playId = next.Id; cache.set(next.Id, next); resumeLabel = next.UserData?.PlaybackPositionTicks ? `Resume S${next.ParentIndexNumber} E${next.IndexNumber}` : next.fresh ? 'Start watching' : `Play S${next.ParentIndexNumber} E${next.IndexNumber}`; }
  } else if (it.UserData?.PlaybackPositionTicks) resumeLabel = `Resume from ${fmtTimeTicks(it.UserData.PlaybackPositionTicks)}`;
  if (!alive()) return '';
  return `    ${['Movie', 'Episode', 'Series'].includes(it.Type) ? await prePlay(it, playId, owner, alive) : ''}
    <div class="acts">
      ${it.Type !== 'BoxSet' ? `<button class="btn gold big" data-play="${playId}">${icon('play')} ${esc(resumeLabel)}</button>` : ''}
      ${it.UserData?.PlaybackPositionTicks ? `<button class="btn big" data-play-start="${it.Id}">From the start</button>` : ''}
      ${it.RemoteTrailers?.[0] ? `<button class="btn big" data-open="${esc(it.RemoteTrailers[0].Url)}">${icon('film')} Trailer</button>` : ''}
      <button class="icon-btn ${it.UserData?.Played ? 'on' : ''}" data-watched="${it.Id}" title="Mark watched">${icon('check')}</button>
      <button class="icon-btn ${it.UserData?.IsFavorite ? 'on' : ''}" data-fav="${it.Id}" title="Favorite">${icon('heart')}</button>
      ${desktop && ['Movie', 'Episode'].includes(it.Type) ? `<button class="icon-btn" data-download="${it.Id}" title="Download to watch offline">${icon('download')}</button>` : ''}
    </div>`;
}
const fmtTimeTicks = (t) => { const s = Math.floor(t / 1e7); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };
// Which servers have this title, with the quality of each copy; pick one to watch from there
const resLabel = (src) => { const v = (src?.MediaStreams || []).find((x) => x.Type === 'Video'); const h = v?.Height || 0, w = v?.Width || 0; return w >= 3200 || h >= 2000 ? '4K' : w >= 1800 || h >= 1000 ? '1080p' : w >= 1200 || h >= 700 ? '720p' : h ? `${h}p` : ''; };
async function copiesBlock(it, owner = groups.active()) {
  if (groups.with('jellyfin').length < 2) return '';
  const here = owner.id;
  it._g ||= here;
  const key = it.Type === 'Movie' ? pid(it, 'Tmdb', 'Imdb') : showKey(it);
  if (!key) return '';
  const [k, v] = key.split(':');
  const prov = `${k[0].toUpperCase() + k.slice(1)}.${v}`;
  const found = await Promise.all(groups.with('jellyfin').filter((g) => g.id !== here).map((g) => Promise.resolve(groups.run(g, () => jf.items({ provider: prov, types: it.Type, limit: 2 }))).then((r) => groups.tag(g, r.Items || [])[0] || null).catch(() => null)));
  const copies = [it, ...found.filter(Boolean)];
  if (copies.length < 2) return '';
  // Quality of each copy (movies carry their file details; shows use their first episode's)
  const detail = await Promise.all(copies.map((c) => c === it ? Promise.resolve(it) : Promise.resolve(groups.run(groups.byId(c._g), () => jf.item(c.Id))).catch(() => c)));
  const best = (c) => { const d = detail[copies.indexOf(c)]; return c.Type === 'Movie' ? resLabel(d?.MediaSources?.[0]) : ''; };
  return `<div class="copies"><span class="copies-lab">Watch on</span>${copies.map((c) => { const on = c._g === here, d = detail[copies.indexOf(c)]; const pct = d?.UserData?.PlayedPercentage; const q = best(c);
    return `<a class="copy ${on ? 'on' : ''}" href="#/item/${c.Id}@${c._g}"><span class="copy-orb">${esc(groups.nameOf(groups.byId(c._g)).slice(0, 1).toUpperCase())}</span><span><b>${esc(groups.nameOf(groups.byId(c._g)))}</b><small>${[q, d?.UserData?.Played ? 'Watched' : pct ? `${Math.round(pct)}% watched` : '', d?.UserData?.LastPlayedDate ? 'last watched here' : ''].filter(Boolean).join(' · ') || 'Available'}</small></span>${on ? icon('check') : ''}</a>`; }).join('')}</div>`;
}
// Audio and quality pickers on the info page (start on your Settings defaults)
const QUALS = [[0, 'Original quality'], [40e6, '1080p high'], [20e6, '1080p'], [8e6, '720p'], [4e6, '480p'], [1.5e6, 'Data saver']];
export const prePick = { audio: null, quality: null, sub: null, for: null };
async function prePlay(it, playId, owner = groups.active(), alive = () => true) {
  const src = (it.Type === 'Series' ? (await groups.run(owner, () => jf.item(playId)).catch(() => null)) : it)?.MediaSources?.[0];
  if (!alive()) return '';
  const audio = (src?.MediaStreams || []).filter((x) => x.Type === 'Audio');
  if (prePick.for !== it.Id) Object.assign(prePick, { audio: null, quality: null, sub: null, for: it.Id });
  const tracks = await import('./tracks.js');
  const list = audio.map((x) => ({ index: x.Index, label: x.DisplayTitle || x.Language || `Track ${x.Index}`, lang: x.Language || '', isDefault: !!x.IsDefault }));
  // A show: choose by language, so it carries over to every episode
  const langs = [...new Map(list.map((a) => [a.lang || a.label, a])).values()];
  const auto = tracks.pickAudio(list, src?.DefaultAudioStreamIndex);
  const autoLang = list.find((a) => a.index === auto)?.lang || '';
  const opts = it.Type === 'Series' ? langs.map((a) => [a.lang, (tracks.LANGS.find((l) => tracks.isLang(a, l[0]))?.[1]) || a.label]) : list.map((a) => [String(a.index), a.label]);
  const sel = prePick.audio ?? (it.Type === 'Series' ? autoLang : String(auto));
  const q = prePick.quality ?? settings.playback.maxBitrate ?? 0;
  // Subtitles: Auto follows your rules; a show picks by language so it carries to every episode
  const subs = (src?.MediaStreams || []).filter((x) => x.Type === 'Subtitle').map((x) => ({ index: x.Index, label: x.DisplayTitle || x.Language || `Track ${x.Index}`, lang: x.Language || '', forced: !!x.IsForced, textBased: !!x.IsTextSubtitleStream }));
  const langName = (t) => tracks.LANGS.find((l) => tracks.isLang(t, l[0]))?.[1] || t.label;
  const subOpts = it.Type === 'Series'
    ? [...new Map(subs.filter((x) => !x.forced).map((x) => [x.lang || x.label, x])).values()].map((x) => [`lang:${x.lang}`, langName(x)])
    : subs.map((x) => [String(x.index), x.label + (x.forced ? ' (forced)' : '')]);
  const autoSub = tracks.pickSub(subs, list.find((a) => a.index === auto));
  const autoName = autoSub == null ? 'Off' : (it.Type === 'Series' ? langName(subs.find((x) => x.index === autoSub)) : subs.find((x) => x.index === autoSub)?.label);
  const sv = prePick.sub ?? 'auto';
  return `<div class="preplay">
    ${opts.length > 1 ? `<label class="pp">${icon('volume')}<select data-preaudio>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
    ${subs.length ? `<label class="pp">${icon('subs')}<select data-presub><option value="auto" ${sv === 'auto' ? 'selected' : ''}>Auto (${esc(autoName || 'Off')})</option><option value="off" ${sv === 'off' ? 'selected' : ''}>Subtitles off</option>${subOpts.map(([v, l]) => `<option value="${esc(v)}" ${sv === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
    <label class="pp">${icon('speed')}<select data-prequality>${QUALS.map(([v, l]) => `<option value="${v}" ${Number(q) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
}
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-preaudio]')) prePick.audio = e.target.value;
  if (e.target.matches('[data-prequality]')) prePick.quality = Number(e.target.value);
  if (e.target.matches('[data-presub]')) prePick.sub = e.target.value;
});
async function seasonsBlock(series, seasonId, owner = groups.active()) {
  const seasons = await groups.run(owner, () => jf.seasons(series.Id));
  if (!seasons.length) return '';
  const cur = seasons.find((s) => s.Id === seasonId) || seasons.find((s) => !s.UserData?.Played && s.IndexNumber > 0) || seasons[0];
  const eps = remember(groups.tag(owner, await groups.run(owner, () => jf.episodes(series.Id, cur.Id))));
  return `<section class="row"><div class="row-head"><h3>Episodes</h3><span style="display:flex;gap:8px">${cur.UserData && !cur.UserData.Played ? `<button class="btn small" data-watched="${cur.Id}">${icon('check')} Mark season watched</button>` : ''}</span></div>
    <div class="season-pick">${seasons.map((s) => { const pic = jf.img(s, 'Primary', 240) || jf.img(series, 'Primary', 240); const n = s.ChildCount; return `<a class="season ${s.Id === cur.Id ? 'on' : ''}" href="#/item/${series.Id}/${s.Id}">${pic ? `<img loading="lazy" src="${esc(pic)}" alt="">` : ''}<span class="season-in"><b>${esc(s.Name)}</b>${n ? `<small>${n} episode${n === 1 ? '' : 's'}</small>` : ''}</span>${s.UserData?.Played ? `<span class="check">${icon('check')}</span>` : ''}</a>`; }).join('')}</div>
    <div class="episodes ${settings.app.covers ? 'big' : 'compact'}">${eps.map((e) => { const tp = tpInfo(e); return `<div class="ep" data-id="${e.Id}">
      ${settings.app.covers ? `<button class="card" data-play="${e.Id}" style="cursor:pointer"${tp ? ` data-tp="${esc(JSON.stringify(tp))}"` : ''}><div class="art">${jf.img(e, 'Thumb', 640) ? `<img loading="lazy" src="${esc(jf.img(e, 'Thumb', 640))}" alt="">` : `<span class="ph">${e.IndexNumber ?? ''}</span>`}<span class="tp"></span><span class="num">${e.IndexNumber ?? ''}</span>${e.RunTimeTicks ? `<span class="len">${esc(fmtRuntime(e.RunTimeTicks))}</span>` : ''}${e.UserData?.PlayedPercentage ? `<span class="bar"><i style="width:${e.UserData.PlayedPercentage}%"></i></span>` : ''}${e.UserData?.Played ? `<span class="check">${icon('check')}</span>` : ''}<span class="play-over"><span>${icon('play')}</span></span></div></button>` : `<button class="icon-btn play-sm" data-play="${e.Id}" title="Play">${icon('play')}</button>`}
      <div><h4>${e.IndexNumber ?? ''}. ${esc(e.Name)}</h4><p>${esc(e.Overview || '')}</p><small style="color:var(--dim)">${esc([fmtRuntime(e.RunTimeTicks), e.PremiereDate ? new Date(e.PremiereDate).toLocaleDateString() : ''].filter(Boolean).join(' · '))}</small></div>
      <div class="acts"><button class="icon-btn ${e.UserData?.Played ? 'on' : ''}" data-watched="${e.Id}" title="Mark watched">${icon('check')}</button>${desktop ? `<button class="icon-btn" data-download="${e.Id}" title="Download">${icon('download')}</button>` : ''}</div>
    </div>`; }).join('')}</div></section>`;
}
// Picking a season swaps only the episode list, so the page and the season row keep their scroll
document.addEventListener('click', async (e) => {
  const a = e.target.closest?.('.season-pick a.season');
  if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  if (a.classList.contains('on')) return;
  const href = a.getAttribute('href'), [seriesId, seasonId] = href.replace(/^#\/item\//, '').split('/');
  const sec = a.closest('section.row'), left = a.closest('.season-pick').scrollLeft;
  sec.querySelector('.season.on')?.classList.remove('on'); a.classList.add('on');
  try {
    const series = cache.get(seriesId) || await jf.item(seriesId);
    const html = await seasonsBlock(series, seasonId);
    if (!sec.isConnected) return;
    const box = document.createElement('div'); box.innerHTML = html;
    const fresh = box.firstElementChild; if (!fresh) return;
    sec.replaceWith(fresh);
    fresh.querySelector('.season-pick').scrollLeft = left;
    history.replaceState(null, '', href);
  } catch { location.hash = href; }
});
// Trickplay frames for the hover preview (Jellyfin 10.9+)
function tpInfo(e) {
  const bySource = e.Trickplay && Object.values(e.Trickplay)[0];
  const src = e.Trickplay && Object.keys(e.Trickplay)[0];
  if (!bySource) return null;
  const w = Object.keys(bySource).map(Number).sort((x, y) => x - y).find((x) => x >= 300) || Number(Object.keys(bySource).pop());
  const i = bySource[w]; if (!i) return null;
  return { url: jf.trickplayUrl(e.Id, w, '{n}', src), w: i.Width, h: i.Height, cols: i.TileWidth, rows: i.TileHeight, count: i.ThumbnailCount };
}
let tpTimer = null;
document.addEventListener('pointerover', (ev) => {
  const btn = ev.target.closest?.('.episodes.big [data-tp]');
  if (!btn || btn.contains(ev.relatedTarget)) return;
  const t = JSON.parse(btn.dataset.tp), el = btn.querySelector('.tp'), per = t.cols * t.rows;
  const steps = 24, frames = Array.from({ length: steps }, (_, k) => Math.floor(((k + 1) / (steps + 1)) * t.count));
  let k = 0;
  const show = () => {
    const n = frames[k++ % steps], sheet = Math.floor(n / per), i = n % per;
    const scale = btn.clientWidth / t.w;
    el.style.backgroundImage = `url('${t.url.replace('{n}', sheet)}')`;
    el.style.backgroundSize = `${t.w * t.cols * scale}px auto`;
    el.style.backgroundPosition = `-${(i % t.cols) * t.w * scale}px -${Math.floor(i / t.cols) * t.h * scale}px`;
    btn.classList.add('previewing');
  };
  clearInterval(tpTimer);
  tpTimer = setTimeout(() => { show(); tpTimer = setInterval(show, 650); }, 350);
  btn.addEventListener('pointerleave', () => { clearTimeout(tpTimer); clearInterval(tpTimer); btn.classList.remove('previewing'); }, { once: true });
});
async function boxsetBlock(set) {
  const r = await jf.items({ parentId: set.Id, sort: 'PremiereDate', recursive: false, limit: 100 });
  return `<section class="row"><div class="row-head"><h3>In this collection</h3></div><div class="grid">${remember(r.Items).map((i) => card(i)).join('')}</div></section>`;
}
async function personPage(p) {
  const work = await jf.byPerson(p.Id).catch(() => ({ Items: [] }));
  return `<div class="detail-in" style="padding:20px 0;grid-template-columns:200px minmax(0,1fr)"><div class="art">${jf.img(p, 'Primary', 400) ? `<img src="${esc(jf.img(p, 'Primary', 400))}" alt="">` : ''}</div><div><span class="kicker">Person</span><h1 style="font:700 40px var(--disp);margin:6px 0">${esc(p.Name)}</h1><p class="overview">${esc(p.Overview || '')}</p></div></div>
  <section class="row"><div class="row-head"><h3>On your server</h3></div><div class="grid">${remember(work.Items || []).map((i) => card(i)).join('') || '<p style="color:var(--mute)">Nothing yet.</p>'}</div></section>`;
}

// ── Search (everything at once) ────────────────────────────────────────
route('search', async (q = '') => {
  q = q.trim();
  if (q.length < 2) return `<div class="empty"><h2>Search</h2><p>Type at least two letters in the search box.</p></div>`;
  const [watch, read, req] = await Promise.all([
    fromAll('jellyfin', () => jf.search(q)).then((Items) => ({ Items: merge(Items) })),
    Promise.all(groups.with('kavita').map((g) => Promise.resolve(groups.run(g, () => kv.search(q))).then((r) => ({ series: groups.tag(g, (r?.series || []).map((x) => ({ ...x }))) })).catch(() => null))).then((rs) => ({ series: rs.flatMap((r) => r?.series || []) })),
    rq.provider() ? rq.search(q).catch(() => null) : null,
  ]);
  const items = remember(watch.Items || []);
  const titles = items.filter((i) => ['Movie', 'Series', 'BoxSet'].includes(i.Type));
  const eps = items.filter((i) => i.Type === 'Episode');
  const people = items.filter((i) => i.Type === 'Person');
  const series = read?.series || [];
  const onServer = new Set(titles.map((t) => t.Name.toLowerCase()));
  const toRequest = (req?.video || []).filter((x) => x.status !== 'available' && !onServer.has(x.title.toLowerCase()));
  const toReadRequest = (req?.reading || []).filter((x) => x.status !== 'available');
  const html = [
    titles.length ? `<section class="row"><div class="row-head"><h3>On your server</h3></div><div class="grid">${titles.map((i) => card(i)).join('')}</div></section>` : '',
    eps.length ? shelf('Episodes', eps.map((i) => card(i, { wide: true })).join(''), '', true) : '',
    series.length ? `<section class="row"><div class="row-head"><h3>To read</h3></div><div class="grid">${series.map((s) => readCard({ id: s.seriesId, name: s.name, libraryName: s.libraryName, _g: s._g })).join('')}</div></section>` : '',
    people.length ? `<section class="row"><div class="row-head"><h3>People</h3></div><div class="people">${people.map((p) => `<a class="person" href="#/item/${p.Id}" style="text-decoration:none"><div class="face">${jf.img(p, 'Primary', 200) ? `<img loading="lazy" src="${esc(jf.img(p, 'Primary', 200))}" alt="">` : ''}</div><b>${esc(p.Name)}</b></a>`).join('')}</div></section>` : '',
    toRequest.length ? `<section class="row"><div class="row-head"><h3>Not here yet? Request it</h3></div><div class="grid">${toRequest.slice(0, 24).map(requestCard).join('')}</div></section>` : '',
    toReadRequest.length ? `<section class="row"><div class="row-head"><h3>Books, manga and comics to request</h3></div><div class="grid">${toReadRequest.slice(0, 24).map(requestCard).join('')}</div></section>` : '',
  ].join('');
  return `<div class="page-head"><div><span class="kicker">Search</span><h1>${esc(q)}</h1></div></div>${html || `<div class="empty"><h2>No results</h2><p>Nothing matched "${esc(q)}".</p></div>`}`;
});

export const needServer = (name) => `<div class="empty"><h2>Connect ${esc(name)} first</h2><p>Add your ${esc(name)} server in settings.</p><a class="btn gold" href="#/settings">Open settings</a></div>`;



// Where a show starts for this person, worked out from their own watch history:
//  - an episode half watched: that one
//  - watched some: the first unwatched episode after the last one they watched
//  - never watched: season 1, episode 1
export async function startEpisode(seriesId, owner = groups.active()) {
  const eps = (await groups.run(owner, () => jf.allEpisodes(seriesId))).filter((e) => (e.ParentIndexNumber ?? 1) > 0);
  const list = groups.tag(owner, eps.length ? eps : await groups.run(owner, () => jf.allEpisodes(seriesId)));
  list.sort((a, b) => (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) || (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0));
  remember(list);
  const when = (e) => Date.parse(e.UserData?.LastPlayedDate || 0) || 0;
  const partway = list.filter((e) => e.UserData?.PlaybackPositionTicks > 0 && !e.UserData?.Played).sort((a, b) => when(b) - when(a))[0];
  // Rewatching: carry on from the episode you finished most recently, even if you've seen later ones
  if (settings.app.rewatch !== false) {
    const recent = list.filter((e) => e.UserData?.Played && when(e)).sort((a, b) => when(b) - when(a))[0];
    if (recent && (!partway || when(recent) > when(partway))) {
      const next = list[list.indexOf(recent) + 1];
      if (next) return next;
    }
  }
  if (partway) return partway;
  let last = -1;
  list.forEach((e, i) => { if (e.UserData?.Played) last = i; });
  if (last === -1) return list[0] ? { ...list[0], fresh: true } : null;
  return list.slice(last + 1).find((e) => !e.UserData?.Played) || list[0];
}

// ── Actions on cards and pages ─────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const playBtn = e.target.closest('[data-play]');
  if (playBtn) {
    e.preventDefault(); e.stopPropagation();
    const id = playBtn.dataset.play;
    let it = cache.get(id);
    if (it?._g) groups.use(it._g);
    if (!it || it.Type === 'Series') it = await jf.item(id).catch((err) => { toast(err.message, 'bad'); return null; });
    if (it?.Type === 'Series') { const n = await startEpisode(it.Id); if (n) it = n; }
    if (it) player.play(it).catch((err) => toast(err.message, 'bad'));
    return;
  }
  const fromStart = e.target.closest('[data-play-start]');
  if (fromStart) { const it = cache.get(fromStart.dataset.playStart) || await jf.item(fromStart.dataset.playStart); return player.play(it, { start: 0 }); }
  const w = e.target.closest('[data-watched]');
  if (w) {
    const on = !w.classList.contains('on');
    try { await jf.setWatched(w.dataset.watched, on); w.classList.toggle('on', on); toast(on ? 'Marked as watched' : 'Marked as not watched', 'ok'); } catch (err) { toast(err.message, 'bad'); }
    return;
  }
  const fav = e.target.closest('[data-fav]');
  if (fav) { const on = !fav.classList.contains('on'); try { await jf.setFavorite(fav.dataset.fav, on); fav.classList.toggle('on', on); toast(on ? 'Added to favorites' : 'Removed from favorites', 'ok'); } catch (err) { toast(err.message, 'bad'); } return; }
  const dl = e.target.closest('[data-download]');
  if (dl && desktop) {
    const it = cache.get(dl.dataset.download) || await jf.item(dl.dataset.download);
    const src = it.MediaSources?.[0] || (await jf.item(it.Id)).MediaSources?.[0];
    const name = (it.Type === 'Episode' ? `${it.SeriesName} S${String(it.ParentIndexNumber).padStart(2, '0')}E${String(it.IndexNumber).padStart(2, '0')} ${it.Name}` : `${it.Name}${it.ProductionYear ? ` (${it.ProductionYear})` : ''}`) + '.' + (src?.Container || 'mkv').split(',')[0];
    emit('download', { id: it.Id, name, url: jf.downloadUrl(it.Id), size: src?.Size || 0 });
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) { e.preventDefault(); desktop ? desktop.open(open.dataset.open) : window.open(open.dataset.open, '_blank', 'noopener'); return; }
  const sc = e.target.closest('[data-scroll]');
  if (sc) { const strip = sc.parentElement.querySelector('.strip'); strip.scrollBy({ left: Number(sc.dataset.scroll) * strip.clientWidth * 0.85 }); }
});
// After playback, refresh the page so progress bars and "Next up" are current
on('player', ({ open }) => { if (!open && ['home', 'item', 'movies', 'shows', 'library'].includes(location.hash.replace(/^#\/?/, '').split('/')[0] || 'home')) import('./core.js').then((c) => c.render()); });
