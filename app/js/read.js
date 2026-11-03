// Reading (Kavita): libraries, a series' page, and the reader for manga, comics and books.
import { $, $$, esc, icon, route, settings, save, toast, desktop, plural, loading, groups, splitId } from './core.js';
import * as kv from './kavita.js';
import { anilist } from './meta.js';
import { readCard, shelf, needServer } from './watch.js';

route('read', async (libId) => {
  if (libId) libId = splitId(libId);
  if (!kv.ready()) return needServer('Kavita');
  const libs = await kv.libraries();
  if (!libId) {
    const all = async (fn) => (await Promise.all(groups.with('kavita').map((g) => Promise.resolve(groups.run(g, fn)).then((x) => groups.tag(g, x || [])).catch(() => [])))).flat();
    const [deck, recent] = await Promise.all([all(() => kv.onDeck()), all(() => kv.recent())]);
    return `<div class="page-head"><div><span class="kicker">Read</span><h1>Your shelf</h1></div></div>
      <div class="chips"><a class="chip on" href="#/read" style="text-decoration:none">Home</a>${libs.map((l) => `<a class="chip" href="#/read/${l.id}" style="text-decoration:none">${esc(l.name)}</a>`).join('')}</div>
      ${shelf('Keep reading', (deck || []).map(readCard).join(''))}${shelf('Recently added', (recent || []).map(readCard).join(''))}
      ${!deck?.length && !recent?.length ? '<div class="empty"><h2>Your shelf is empty</h2><p>Pick a library above.</p></div>' : ''}`;
  }
  setTimeout(() => fillSeries(libId, 1), 0);
  return `<div class="page-head"><div><span class="kicker">Read</span><h1>${esc(libs.find((l) => String(l.id) === String(libId))?.name || 'Library')}</h1></div><p id="rd-count"></p></div>
    <div class="chips"><a class="chip" href="#/read" style="text-decoration:none">Home</a>${libs.map((l) => `<a class="chip ${String(l.id) === String(libId) ? 'on' : ''}" href="#/read/${l.id}" style="text-decoration:none">${esc(l.name)}</a>`).join('')}</div>
    <div class="grid" id="rd-grid" data-lib="${esc(libId)}">${loading(18)}</div><div class="acts" style="justify-content:center;margin-top:20px"><button class="btn" id="rd-more" hidden>Load more</button></div>`;
});
async function fillSeries(libId, page) {
  const grid = $('#rd-grid'); if (!grid) return;
  try {
    const list = await kv.seriesIn(libId, page, 60);
    const html = (list || []).map((s) => readCard({ ...s, libraryName: '' })).join('');
    if (page === 1) grid.innerHTML = html || '<div class="empty" style="grid-column:1/-1"><h2>Nothing here yet</h2></div>'; else grid.insertAdjacentHTML('beforeend', html);
    const more = $('#rd-more'); if (more) { more.hidden = (list || []).length < 60; more.onclick = () => fillSeries(libId, page + 1); }
  } catch (e) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Couldn't load this library</h2><p>${esc(e.message)}</p></div>`; }
}

route('series', async (id) => {
  id = splitId(id);
  if (!kv.ready()) return needServer('Kavita');
  const [s, meta, vols, cont] = await Promise.all([kv.series(id), kv.metadata(id), kv.volumes(id), kv.continuePoint(id)]);
  const pct = s.pages ? Math.round((s.pagesRead / s.pages) * 100) : 0;
  const chapters = vols.flatMap((v) => (v.chapters || []).map((c) => ({ ...c, vol: v })));
  const label = (c) => (c.isSpecial ? c.title || c.range : c.vol.minNumber > 0 && c.vol.name !== '-100000' && (c.number === '-100000' || c.minNumber <= -100000 || c.range === '-100000') ? `Volume ${c.vol.name}` : c.titleName || c.title || `Chapter ${c.range || c.number}`);
  // Banner and missing info from AniList (manga and comics), matched by title
  const al = s.format === 3 ? null : await anilist(s.name).catch(() => null);
  const summary = (meta?.summary || '').replace(/<[^>]+>/g, '').trim() || al?.summary || '';
  const genres = (meta?.genres || []).map((g) => g.title).filter(Boolean).length ? meta.genres.map((g) => g.title) : al?.genres || [];
  const writers = (meta?.writers || []).map((w) => w.name).filter(Boolean).length ? meta.writers.map((w) => w.name) : al?.authors || [];
  const volCount = chapters.filter((c) => label(c).startsWith("Volume ")).length;
  const own = chapters.slice(0, 9).map((c) => (label(c).startsWith('Volume ') ? kv.volumeCover(c.vol.id) : kv.chapterCover(c.id)));
  const covers = own.length ? Array.from({ length: 9 }, (_, i) => own[i % own.length]) : [kv.cover(id)];
  const banner = al?.banner
    ? `<div class="backdrop"><img src="${esc(al.banner)}" alt=""></div>`
    : `<div class="backdrop collage">${covers.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>`;
  const facts = [meta?.releaseYear || al?.year || '', al?.status || '', al?.score ? `<span class="star">${icon('star')} ${(al.score / 10).toFixed(1)}</span>` : '', volCount ? plural(volCount, "volume") : plural(chapters.length, 'chapter'), plural(s.pages || 0, 'page')].filter(Boolean);
  return `<div class="detail">${banner}
  <div class="detail-in"><div class="art"><img src="${esc(kv.cover(id))}" alt=""></div><div>
    <span class="kicker">${esc(s.libraryName || 'Read')}</span><h1>${esc(s.name)}</h1>
    ${writers.length ? `<p class="tagline">By ${esc(writers.slice(0, 2).join(' and '))}</p>` : ''}
    <div class="facts">${facts.map((f) => (String(f).startsWith("<") ? f : esc(f))).join('<span>·</span>')}</div>
    ${genres.length ? `<div class="genre-pills">${genres.slice(0, 6).map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
    <p class="overview clamp">${esc(summary) || '<span style="color:var(--mute)">No summary yet.</span>'}</p>
    ${pct ? `<div class="read-progress"><div class="progress"><i style="width:${pct}%"></i></div><small>${pct}% read</small></div>` : ''}
    <div class="acts">${cont ? `<button class="btn gold big" data-read="${cont.id}" data-series="${id}">${icon('book')} ${pct ? 'Continue' : 'Start reading'}</button>` : ''}
      <button class="btn big" data-markread="${id}" data-on="${pct >= 100 ? '0' : '1'}">${icon('check')} ${pct >= 100 ? 'Mark unread' : 'Mark as read'}</button>
      ${al?.url ? `<button class="btn big" data-open="${esc(al.url)}">${icon('link')} AniList</button>` : ''}</div>
  </div></div></div>
  <section class="row"><div class="row-head"><h3>${plural(chapters.length, 'entry', 'entries')}</h3></div>
  ${settings.app.covers ? `<div class="grid vols">${chapters.map((c) => { const isVol = label(c).startsWith('Volume '); const done = c.pages && c.pagesRead >= c.pages; return `<button class="card vol" data-read="${c.id}" data-series="${id}"><div class="art book"><img loading="lazy" src="${esc(isVol ? kv.volumeCover(c.vol.id) : kv.chapterCover(c.id))}" alt="" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${esc(kv.chapterCover(c.id))}'}"><span class="shine"></span>${c.pagesRead && c.pages ? (done ? `<span class="check">${icon('check')}</span>` : `<span class="bar"><i style="width:${Math.round((c.pagesRead / c.pages) * 100)}%"></i></span>`) : ''}<span class="read-over"><span>${icon('book')}</span></span></div><b>${esc(label(c))}</b><small>${done ? 'Read' : c.pagesRead ? `${Math.round((c.pagesRead / c.pages) * 100)}% read` : plural(c.pages || 0, 'page')}</small></button>`; }).join('')}</div>`
  : `<div class="list-plain">${chapters.map((c) => `<button class="lp" data-read="${c.id}" data-series="${id}"><b>${esc(label(c))}</b><small>${plural(c.pages || 0, 'page')}</small>${c.pages && c.pagesRead >= c.pages ? `<span class="ok">${icon('check')}</span>` : c.pagesRead ? `<span class="pct">${Math.round((c.pagesRead / c.pages) * 100)}%</span>` : ''}</button>`).join('')}</div>`}</section>`;
});

document.addEventListener('click', async (e) => {
  const r = e.target.closest('[data-read]');
  if (r) { e.preventDefault(); return openReader(Number(r.dataset.read), Number(r.dataset.series)).catch((err) => toast(err.message, 'bad')); }
  const m = e.target.closest('[data-markread]');
  if (m) { try { if (m.dataset.on === '1') await kv.markRead(Number(m.dataset.markread)); else await kv.markUnread(Number(m.dataset.markread)); toast('Saved', 'ok'); (await import('./core.js')).render(); } catch (err) { toast(err.message, 'bad'); } }
});

// ── The reader ─────────────────────────────────────────────────────────
let R = null;
const el = () => $('#reader');
export async function openReader(chapterId, seriesId) {
  const info = await kv.chapterInfo(chapterId);
  const book = kv.isBook(info.fileFormat ?? info.format);
  const prog = await kv.getProgress(chapterId);
  R = { chapterId, seriesId: seriesId || info.seriesId, volumeId: info.volumeId, libraryId: info.libraryId, pages: info.pages, page: Math.min(prog?.pageNum || 0, Math.max(0, info.pages - 1)), book, title: info.seriesName || info.title || '', sub: info.subtitle || info.chapterTitle || '' };
  if (R.page >= info.pages - 1 && info.pages > 1) R.page = 0;
  const o = settings.reader;
  el().hidden = false;
  el().className = book ? (o.bookTheme === 'dark' ? '' : o.bookTheme) : '';
  el().innerHTML = `<div class="rd-top"><button class="icon-btn" data-rd="close" title="Back (Esc)">${icon('back')}</button><div class="t"><b>${esc(R.title)}</b><small>${esc(R.sub)}</small></div>
    ${book ? `<button class="icon-btn" data-rd="toc" title="Chapters">${icon('list')}</button><button class="btn small" data-rd="font-">A-</button><button class="btn small" data-rd="font+">A+</button><select data-rd-theme aria-label="Page color"><option value="dark">Night</option><option value="sepia">Sepia</option><option value="paper">Paper</option></select>`
    : `<select data-rd-mode aria-label="Layout"><option value="paged">One page</option><option value="double">Two pages</option><option value="webtoon">Long strip</option></select><select data-rd-dir aria-label="Direction"><option value="ltr">Left to right</option><option value="rtl">Right to left (manga)</option></select><select data-rd-fit aria-label="Fit"><option value="height">Fit height</option><option value="width">Fit width</option></select>`}
    ${desktop ? `<button class="icon-btn" data-rd="pin" title="Keep on top">${icon('pin')}</button>` : ''}<button class="icon-btn" data-rd="full" title="Full screen (F)">${icon('expand')}</button></div>
    <div class="rd-body" tabindex="0"></div>
    <div class="rd-bottom"><button class="icon-btn" data-rd="prev">${icon('back')}</button><input type="range" min="0" max="${Math.max(0, R.pages - 1)}" value="${R.page}" aria-label="Page"><span class="rd-count"></span><button class="icon-btn" data-rd="next">${icon('next')}</button></div>`;
  const rt = $('[data-rd-theme]'); if (rt) rt.value = o.bookTheme;
  const md = $('[data-rd-mode]'); if (md) { md.value = o.mode; $('[data-rd-dir]').value = o.direction; $('[data-rd-fit]').value = o.fit; }
  $('.rd-bottom input').oninput = (ev) => go(Number(ev.target.value));
  el().onclick = onClick;
  el().onchange = onChange;
  desktop?.discord(settings.app.discord ? { type: 'reading', details: R.title, state: R.sub || 'Reading', text: 'Reading on Zenith' } : null);
  draw();
  $('.rd-body').focus();
}
function draw() {
  const body = $('.rd-body'), o = settings.reader;
  if (!body) return;
  if (R.book) { drawBook(body); return; }
  body.className = `rd-body ${o.mode === 'webtoon' ? 'webtoon' : 'paged'} ${o.mode === 'double' ? 'double' : ''} fit-${o.fit}`;
  if (o.mode === 'webtoon') {
    if (!body.dataset.strip) {
      body.dataset.strip = '1';
      body.innerHTML = Array.from({ length: R.pages }, (_, i) => `<img loading="lazy" data-p="${i}" src="${esc(kv.pageImage(R.chapterId, i))}" alt="Page ${i + 1}">`).join('');
      const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { R.page = Number(en.target.dataset.p); paintCount(); saveProg(); } }, { root: body, threshold: 0.5 });
      $$('img', body).forEach((im) => io.observe(im));
      setTimeout(() => body.querySelector(`[data-p="${R.page}"]`)?.scrollIntoView(), 50);
    }
  } else {
    delete body.dataset.strip;
    const pages = o.mode === 'double' && R.page > 0 ? [R.page, R.page + 1].filter((p) => p < R.pages) : [R.page];
    if (o.direction === 'rtl') pages.reverse();
    body.innerHTML = `<div class="rd-zone l" data-rd="${o.direction === 'rtl' ? 'next' : 'prev'}"></div>${pages.map((p) => `<img src="${esc(kv.pageImage(R.chapterId, p))}" alt="Page ${p + 1}">`).join('')}<div class="rd-zone r" data-rd="${o.direction === 'rtl' ? 'prev' : 'next'}"></div>`;
    // Load the next pages early
    for (let i = 1; i <= 3; i++) if (R.page + i < R.pages) new Image().src = kv.pageImage(R.chapterId, R.page + i);
  }
  paintCount();
  saveProg();
}
async function drawBook(body) {
  body.className = 'rd-body';
  body.innerHTML = '<div class="book"><p style="color:var(--mute)">Loading...</p></div>';
  try {
    const html = await kv.bookPage(R.chapterId, R.page);
    const doc = new DOMParser().parseFromString(typeof html === 'string' ? html : '', 'text/html');
    doc.querySelectorAll('script,style,link,iframe,object,embed').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((n) => { for (const a of [...n.attributes]) if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); });
    // Pictures in books come from Kavita and need the account key
    doc.querySelectorAll('img[src],image').forEach((n) => { const attr = n.tagName.toLowerCase() === 'image' ? 'xlink:href' : 'src'; const v = n.getAttribute(attr) || n.getAttribute('href'); if (v && !/^data:/.test(v)) { const u = new URL(v, settings.servers.kavita.url); if (!u.searchParams.has('apiKey')) u.searchParams.set('apiKey', settings.servers.kavita.apiKey); n.setAttribute(attr, u.href); } });
    const page = body.querySelector('.book');
    page.style.setProperty('--bf', `${settings.reader.bookFont}px`);
    page.innerHTML = doc.body.innerHTML;
    body.scrollTop = 0;
  } catch (e) { body.querySelector('.book').innerHTML = `<p>${esc(e.message)}</p>`; }
  paintCount(); saveProg();
}
function paintCount() { const c = $('.rd-count'); if (c) c.textContent = `${R.page + 1} / ${R.pages}`; const s = $('.rd-bottom input'); if (s) s.value = R.page; }
let saveT;
function saveProg(now = false) {
  if (!R) return;
  const p = { volumeId: R.volumeId, chapterId: R.chapterId, pageNum: R.page + (R.page >= R.pages - 1 ? 1 : 0), seriesId: R.seriesId, libraryId: R.libraryId, bookScrollId: null };
  clearTimeout(saveT);
  if (now) kv.saveProgress(p); else saveT = setTimeout(() => kv.saveProgress(p), 600);
}
async function go(p) {
  const step = settings.reader.mode === 'double' && !R.book && R.page > 0 ? 2 : 1;
  if (p === 'next') p = R.page + step;
  if (p === 'prev') p = R.page - step;
  if (p >= R.pages) {
    const next = await kv.nextChapter(R.seriesId, R.volumeId, R.chapterId);
    if (next > 0) { toast('Next chapter'); return openReader(next, R.seriesId); }
    R.page = R.pages - 1; saveProg(); return toast("That's the end.");
  }
  if (p < 0) { const prev = await kv.prevChapter(R.seriesId, R.volumeId, R.chapterId); if (prev > 0) return openReader(prev, R.seriesId); return; }
  R.page = p;
  if (settings.reader.mode === 'webtoon' && !R.book) $('.rd-body').querySelector(`[data-p="${p}"]`)?.scrollIntoView({ behavior: 'smooth' });
  else draw();
}
function onClick(e) {
  const b = e.target.closest('[data-rd]'); if (!b) { if (e.target.closest('.rd-body') && !R.book) el().classList.toggle('hide-ui'); return; }
  const a = b.dataset.rd;
  if (a === 'close') return closeReader();
  if (a === 'next' || a === 'prev') return go(a);
  if (a === 'full') return desktop ? desktop.win('fullscreen') : (document.fullscreenElement ? document.exitFullscreen() : el().requestFullscreen());
  if (a === 'pin') { b.classList.toggle('on'); return desktop.win('pin', b.classList.contains('on')); }
  if (a === 'font+' || a === 'font-') { settings.reader.bookFont = Math.max(13, Math.min(32, settings.reader.bookFont + (a === 'font+' ? 1 : -1))); save(); $('.book')?.style.setProperty('--bf', `${settings.reader.bookFont}px`); }
  if (a === 'toc') toc();
}
function onChange(e) {
  const o = settings.reader;
  if (e.target.matches('[data-rd-mode]')) o.mode = e.target.value;
  if (e.target.matches('[data-rd-dir]')) o.direction = e.target.value;
  if (e.target.matches('[data-rd-fit]')) o.fit = e.target.value;
  if (e.target.matches('[data-rd-theme]')) { o.bookTheme = e.target.value; el().className = o.bookTheme === 'dark' ? '' : o.bookTheme; }
  save(); if (!e.target.matches('[data-rd-theme]')) draw();
}
async function toc() {
  const list = await kv.bookChapters(R.chapterId);
  const flat = []; const walk = (xs, d = 0) => { for (const x of xs || []) { flat.push({ ...x, d }); walk(x.children, d + 1); } }; walk(list);
  const { modal } = await import('./core.js');
  const m = modal(`<h2>Chapters</h2><div class="stack" style="max-height:60vh;overflow:auto">${flat.map((c) => `<button class="btn" style="justify-content:flex-start;padding-left:${14 + c.d * 16}px" data-toc="${c.page}">${esc(c.title)}</button>`).join('') || '<p>No chapter list in this book.</p>'}</div>`);
  m.onclick = (ev) => { const t = ev.target.closest('[data-toc]'); if (t) { R.page = Number(t.dataset.toc); draw(); m.close(); } };
}
export function closeReader() {
  if (!R) return;
  saveProg(true); R = null;
  el().hidden = true; el().innerHTML = '';
  desktop?.discord(null);
  import('./core.js').then((c) => c.render());
}
document.addEventListener('keydown', (e) => {
  if (!R || /input|select|textarea/i.test(e.target.tagName)) return;
  const rtl = settings.reader.direction === 'rtl' && !R.book;
  const k = e.key;
  if (k === 'Escape') closeReader();
  else if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && settings.reader.mode !== 'webtoon' && !R.book)) { e.preventDefault(); go(rtl ? 'prev' : 'next'); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(rtl ? 'next' : 'prev'); }
  else if (k.toLowerCase() === 'f') desktop ? desktop.win('fullscreen') : el().requestFullscreen?.();
});
