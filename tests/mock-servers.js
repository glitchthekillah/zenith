// Fake Jellyfin, Kavita and ask servers for trying the app without real ones.
//   node tests/mock-servers.js   (Jellyfin :8096, Kavita :5000, ask :3300)
// Needs test media in tests/fixtures (video.mp4, poster.jpg, backdrop.jpg, page.jpg).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const FX = process.env.FIXTURES || path.join(__dirname, 'fixtures');
const send = (res, code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
const file = (res, name, type) => fs.readFile(path.join(FX, name), (e, d) => (e ? send(res, 404, { error: 'missing' }) : send(res, 200, d, type)));
const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const log = [];

// ── Jellyfin ──
const T = 24 * 1e7 * 40 / 24; // 40 s in ticks
const mk = (id, name, type, extra = {}) => ({ Id: id, Name: name, Type: type, ImageTags: { Primary: 'p' }, BackdropImageTags: ['b'], ProductionYear: 2024, OfficialRating: 'PG-13', CommunityRating: 7.8, RunTimeTicks: 40 * 1e7, Overview: `${name} is a test title with a long enough description to fill a few lines on the page and in the hero banner.`, Genres: ['Drama', 'Sci-Fi'], UserData: { PlaybackPositionTicks: 0, Played: false, PlayedPercentage: 0, IsFavorite: false }, ...extra });
const movies = Array.from({ length: 14 }, (_, i) => mk(`m${i}`, ['Starfall', 'The Quiet Hour', 'Neon Harbor', 'Paper Moons', 'Long Way Home', 'Afterglow', 'Glass Garden', 'Night Market', 'Low Tide', 'Signal Fire', 'Echo Park', 'Northbound', 'Ember', 'Halcyon'][i], 'Movie'));
movies[1].UserData = { PlaybackPositionTicks: 12 * 1e7, PlayedPercentage: 30, Played: false };
const series = mk('s1', 'Orbit Station', 'Series', { Status: 'Continuing', RunTimeTicks: 0, UserData: { UnplayedItemCount: 5 } });
const season = { Id: 'se1', Name: 'Season 1', Type: 'Season', IndexNumber: 1, SeriesId: 's1', ImageTags: { Primary: 'p' }, UserData: {} };
const eps = Array.from({ length: 6 }, (_, i) => mk(`e${i}`, `Episode title ${i + 1}`, 'Episode', { SeriesId: 's1', SeriesName: 'Orbit Station', SeasonId: 'se1', SeasonName: 'Season 1', ParentIndexNumber: 1, IndexNumber: i + 1, ImageTags: { Primary: 'p' }, SeriesPrimaryImageTag: 'p', ParentBackdropItemId: 's1', ParentBackdropImageTags: ['b'] }));
if (!process.env.FRESH) eps[0].UserData = { Played: true, PlayedPercentage: 100 };
const all = [...movies, series, season, ...eps];
const views = [{ Id: 'lm', Name: 'Movies', CollectionType: 'movies' }, { Id: 'ls', Name: 'Shows', CollectionType: 'tvshows' }];
function jellyfin(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  log.push(`JF ${req.method} ${p}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (p === '/System/Info/Public') return send(res, 200, { ServerName: 'Test Jellyfin', Id: 'srv', Version: '10.10.0' });
  if (p === '/Users/AuthenticateByName') return body(req).then((b) => (b.Pw === 'wrong' ? send(res, 401, 'Error processing request.', 'text/plain') : send(res, 200, { AccessToken: 'tok', User: { Id: 'u1', Name: b.Username, Policy: { IsAdministrator: true } } })));
  if (/\/Images\/Backdrop/.test(p)) return file(res, 'backdrop.jpg', 'image/jpeg');
  if (/\/Images\//.test(p)) return file(res, 'poster.jpg', 'image/jpeg');
  if (/\/Videos\/[^/]+\/stream/.test(p)) {
    const f = path.join(FX, 'video.mp4'), size = fs.statSync(f).size, range = req.headers.range;
    if (range) { const [s, e] = range.replace('bytes=', '').split('-'); const start = Number(s), end = e ? Number(e) : size - 1; res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' }); return fs.createReadStream(f, { start, end }).pipe(res); }
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' }); return fs.createReadStream(f).pipe(res);
  }
  if (/Subtitles\/\d+\/0\/Stream\.vtt/.test(p)) return send(res, 200, 'WEBVTT\n\n00:00:01.000 --> 00:00:30.000\nThis is a test subtitle\n', 'text/vtt');
  if (p === '/Users/u1/Views') return send(res, 200, { Items: views });
  if (p === '/Users/u1/Items/Resume') return send(res, 200, { Items: [movies[1]] });
  if (p === '/Shows/NextUp') return send(res, 200, { Items: [eps[1]] });
  if (p === '/Users/u1/Items/Latest') return send(res, 200, u.searchParams.get('ParentId') === 'ls' ? [eps[2], eps[3], season, series] : movies.slice(0, 10));
  if (p === '/Shows/s1/Seasons') return send(res, 200, { Items: [season] });
  if (p === '/Shows/s1/Episodes') return send(res, 200, { Items: eps });
  if (/^\/Items\/[^/]+\/Similar$/.test(p)) return send(res, 200, { Items: movies.slice(4, 10) });
  if (/^\/Items\/[^/]+\/PlaybackInfo$/.test(p)) return send(res, 200, { PlaySessionId: 'ps1', MediaSources: [{ Id: 'src1', Container: 'mp4', SupportsDirectPlay: true, SupportsDirectStream: true, Bitrate: 2_000_000, DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1, MediaStreams: [{ Type: 'Video', Index: 0, Codec: 'h264', Width: 1280, Height: 720 }, { Type: 'Audio', Index: 1, DisplayTitle: 'English AAC Stereo', Language: 'eng', IsDefault: true }, { Type: 'Audio', Index: 2, DisplayTitle: 'Japanese AAC Stereo', Language: 'jpn' }, { Type: 'Subtitle', Index: 3, DisplayTitle: 'English', Language: 'eng', IsTextSubtitleStream: true, IsExternal: true }] }] });
  if (p.startsWith('/Sessions/Playing') || p === '/Sessions/Logout' || p.startsWith('/Videos/ActiveEncodings')) return send(res, 204, '');
  if (/^\/MediaSegments\//.test(p)) return send(res, 200, { Items: [{ Type: 'Intro', StartTicks: 2e7, EndTicks: 6e7 }] });
  if (/^\/Users\/u1\/(PlayedItems|FavoriteItems)\//.test(p)) return send(res, 200, {});
  if (p === '/Genres') return send(res, 200, { Items: [{ Name: 'Drama' }, { Name: 'Sci-Fi' }] });
  const one = p.match(/^\/Users\/u1\/Items\/([^/]+)$/);
  if (one) { const it = all.find((x) => x.Id === one[1]); return it ? send(res, 200, { ...it, People: [{ Id: 'pp1', Name: 'Ada Vale', Role: 'Captain', Type: 'Actor' }], Chapters: [{ Name: 'Opening', StartPositionTicks: 0 }, { Name: 'The middle', StartPositionTicks: 20e7 }] }) : send(res, 404, {}); }
  if (p === '/Users/u1/Items') {
    const t = u.searchParams.get('IncludeItemTypes') || '', s = (u.searchParams.get('SearchTerm') || '').toLowerCase();
    let list = all.filter((x) => (!t || t.split(',').includes(x.Type)) && (!s || x.Name.toLowerCase().includes(s)));
    const start = Number(u.searchParams.get('StartIndex') || 0), lim = Number(u.searchParams.get('Limit') || 60);
    return send(res, 200, { Items: list.slice(start, start + lim), TotalRecordCount: list.length });
  }
  send(res, 404, { error: 'not mocked ' + p });
}
// ── Kavita ──
function kavita(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  log.push(`KV ${req.method} ${p}`);
  const series = [{ id: 1, name: 'Moon Courier', libraryName: 'Manga', pages: 20, pagesRead: 6 }, { id: 2, name: 'The Last Library', libraryName: 'Books', pages: 3, pagesRead: 0 }];
  if (p === '/api/Account/login') return body(req).then((b) => send(res, 200, { token: 'kt', refreshToken: 'kr', apiKey: 'kk', username: b.username }));
  if (p === '/api/Plugin/authenticate') return u.searchParams.get('apiKey') === 'k'.repeat(24) ? send(res, 200, { token: 'kt2', apiKey: 'k'.repeat(24), username: 'glitch' }) : send(res, 401, {});
  if (p === '/login') return send(res, 200, '<!doctype html><title>Kavita</title><p>Signing in with Jellyfin...</p><script>setTimeout(()=>localStorage.setItem("kavita-user", JSON.stringify({ username: "glitch", token: "kt3", refreshToken: "kr3", apiKey: "kk3" })), 1500)</script>', 'text/html');
  if (p === '/api/Library/libraries') return send(res, 200, [{ id: 1, name: 'Manga' }, { id: 2, name: 'Books' }]);
  if (p.startsWith('/api/Series/on-deck') || p.startsWith('/api/Series/recently-added') || p.startsWith('/api/Series/all')) return send(res, 200, series);
  if (/^\/api\/Series\/\d+$/.test(p)) return send(res, 200, series.find((s) => s.id === Number(p.split('/').pop())));
  if (p === '/api/Series/metadata') return send(res, 200, { summary: 'A courier on the moon delivers letters nobody expects.', genres: [{ title: 'Adventure' }], writers: [{ name: 'R. Kimura' }], releaseYear: 2021 });
  if (p === '/api/Series/volumes') { const sid = Number(u.searchParams.get('seriesId')); return send(res, 200, [{ id: 10 * sid, name: '1', minNumber: 1, chapters: [{ id: 100 * sid, range: '1', number: '1', pages: sid === 2 ? 3 : 10, pagesRead: 6 }, { id: 100 * sid + 1, range: '2', number: '2', pages: 10, pagesRead: 0 }] }]); }
  if (p === '/api/Reader/continue-point') return send(res, 200, { id: 100 * Number(u.searchParams.get('seriesId')) });
  if (p === '/api/Reader/chapter-info') { const c = Number(u.searchParams.get('chapterId')); return send(res, 200, { seriesName: c >= 200 ? 'The Last Library' : 'Moon Courier', subtitle: 'Chapter 1', pages: c >= 200 ? 3 : 10, seriesId: c >= 200 ? 2 : 1, volumeId: 10, libraryId: 1, fileFormat: c >= 200 ? 3 : 1 }); }
  if (p === '/api/Reader/get-progress') return send(res, 200, { pageNum: 2 });
  if (p === '/api/Reader/progress') return send(res, 200, {});
  if (p.startsWith('/api/Reader/next-chapter') || p.startsWith('/api/Reader/prev-chapter')) return send(res, 200, -1);
  if (p === '/api/Reader/image' || p.startsWith('/api/Image/')) return file(res, p === '/api/Reader/image' ? 'page.jpg' : 'poster.jpg', 'image/jpeg');
  if (/\/api\/Book\/\d+\/book-page/.test(p)) return send(res, 200, `<h2>Chapter ${Number(u.searchParams.get('page')) + 1}</h2><p>It was late when the library opened its doors. ${'The shelves went on and on. '.repeat(30)}</p><script>alert(1)</script>`, 'application/json');
  if (/\/api\/Book\/\d+\/chapters/.test(p)) return send(res, 200, [{ title: 'Opening', page: 0, children: [] }, { title: 'The stacks', page: 1, children: [] }]);
  if (p === '/api/Search/search') return send(res, 200, { series: [{ seriesId: 1, name: 'Moon Courier', libraryName: 'Manga' }] });
  send(res, 404, { error: 'not mocked ' + p });
}
// ── ask site ──
const reqs = [];
function ask(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  log.push(`ASK ${req.method} ${p}`);
  const signed = /ask=s1/.test(req.headers.cookie || '');
  const item = (i, type = 'movie') => ({ key: `${type}:${100 + i}`, type, id: 100 + i, title: ['Dune Sea', 'Paper Planes', 'Cold Open', 'Wildflower', 'Signal', 'Tidewater'][i % 6], year: '2025', poster: '', overview: 'A title you can request.', status: i === 1 ? 'available' : i === 2 ? 'pending' : 'none' });
  if (req.method === 'POST' && req.headers['x-ask'] !== '1') return send(res, 403, { error: 'Refused.' });
  if (p === '/api/login') { res.setHeader('Set-Cookie', 'ask=s1; Path=/; HttpOnly; Secure; SameSite=Lax'); return send(res, 200, { ok: true }); }
  if (p === '/api/me') return signed ? send(res, 200, { name: 'glitch', admin: true, site: 'zenith' }) : send(res, 401, { error: 'Sign in first.' });
  if (!signed) return send(res, 401, { error: 'Sign in first.' });
  if (p === '/api/discover') { const k = u.searchParams.get('kind'); return send(res, 200, { items: Array.from({ length: 12 }, (_, i) => item(i, k === 'book' ? 'book' : k === 'manga' ? 'manga' : k === 'tv' ? 'tv' : 'movie')), page: 1, more: false }); }
  if (p === '/api/search') return send(res, 200, { video: [item(0), item(3, 'tv')], reading: [item(4, 'manga')] });
  if (p === '/api/title') return send(res, 200, { ...item(Number(u.searchParams.get('id')) - 100, u.searchParams.get('type')), genres: ['Drama'], runtime: 110, seasons: u.searchParams.get('type') === 'tv' ? [{ n: 1, name: 'Season 1', episodes: 8, status: 'available' }, { n: 2, name: 'Season 2', episodes: 8, status: 'none' }] : [], quality: { list: [{ id: 1, name: 'HD-1080p' }, { id: 4, name: '4K' }], def: 1 } });
  if (p === '/api/reading-title') return send(res, 200, { volumes: [{ id: 'v1', n: 1, name: 'Volume 1', status: 'available' }, { id: 'v2', n: 2, name: 'Volume 2' }], unitLabel: 'volume', catalogToken: 'ct' });
  if (p === '/api/request') return body(req).then((b) => { reqs.push(b); send(res, 200, { ok: true, status: 'pending', msg: 'Asked. It starts downloading once it is approved.' }); });
  if (p === '/api/mine') return send(res, 200, { items: reqs.map((b, i) => ({ key: `${b.type}:${b.id || i}`, type: b.type, title: b.title || `Request ${i + 1}`, state: 'pending', created: Date.now() })) });
  send(res, 404, { error: 'not mocked' });
}
http.createServer(jellyfin).listen(8096);
http.createServer(kavita).listen(5000);
http.createServer(ask).listen(3300);
process.on('SIGTERM', () => { fs.writeFileSync(path.join(FX, 'mock-log.txt'), log.join('\n') + '\n' + JSON.stringify(reqs)); process.exit(0); });
console.log('mock servers up: jellyfin 8096, kavita 5000, ask 3300');
