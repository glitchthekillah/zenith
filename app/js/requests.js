// Requests, one interface for two kinds of server:
//  - an "ask" site (like zenith's): movies, shows, anime, books, manga and comics
//  - Seerr / Jellyseerr / Overseerr: movies, shows and anime
// When both are set up, the ask site is used (it covers everything).
import { http, settings, save } from './core.js';
import * as seerr from './seerr.js';

const A = () => settings.servers.ask;
const ask = (path, opts = {}) => http(A().url + path, { ...opts, headers: { 'x-ask': '1', ...(opts.headers || {}) } });
// What lists and searches returned, so a title's page has what its card had
export const seen = new Map();
const keep = (d) => { for (const x of [...(d?.items || []), ...(d?.video || []), ...(d?.reading || [])]) seen.set(x.key, x); return d; };
export const provider = () => (A()?.name ? 'ask' : seerr.ready() ? 'seerr' : null);
export const canRead = () => provider() === 'ask';

export async function askSignIn(url, username, password) {
  await http(url + '/api/me').catch((e) => { if (e.status !== 401) throw new Error("That doesn't look like a request site. Check the address."); });
  await http(url + '/api/login', { method: 'POST', headers: { 'x-ask': '1' }, body: { username, password } });
  const me = await http(url + '/api/me');
  settings.servers.ask = { url, name: me.name, site: me.site, admin: !!me.admin };
  save();
  return settings.servers.ask;
}
export async function askSignOut() { try { await ask('/api/logout', { method: 'POST' }); } catch {} settings.servers.ask = null; save(); }

// Seerr results in the ask site's shape, so the interface only knows one shape
const TMDB = 'https://image.tmdb.org/t/p/';
const ST = { 2: 'pending', 3: 'requested', 4: 'partial', 5: 'available' };
const isAnime = (x) => (x.genreIds || (x.genres || []).map((g) => g.id)).includes(16) && (x.originalLanguage === 'ja' || (x.originCountry || []).includes('JP'));
const fromSeerr = (x) => {
  const type = x.mediaType === 'movie' || (x.title && !x.name) ? 'movie' : 'tv';
  return { key: `${type}:${x.id}`, type, id: x.id, title: x.title || x.name || '', year: String(x.releaseDate || x.firstAirDate || '').slice(0, 4),
    poster: x.posterPath ? TMDB + 'w342' + x.posterPath : '', backdrop: x.backdropPath ? TMDB + 'w1280' + x.backdropPath : '',
    overview: x.overview || '', rating: x.voteAverage ? Math.round(x.voteAverage * 10) / 10 : null, anime: isAnime(x), status: ST[x.mediaInfo?.status] || 'none' };
};
const list = (d) => (d?.results || []).filter((x) => x.mediaType !== 'person' && (x.posterPath || x.backdropPath)).map(fromSeerr);

// kind: trending, movie, tv, anime, upcoming, book, manga, comic
export async function discover(kind = 'trending', page = 1) {
  if (provider() === 'ask') return keep(await ask(`/api/discover?kind=${kind}&page=${page}`));
  const fn = { trending: seerr.trending, movie: seerr.popularMovies, tv: seerr.popularTv, anime: seerr.anime, upcoming: seerr.upcoming }[kind];
  if (!fn) return { items: [], page, more: false };
  const d = await fn(page);
  return keep({ items: list(d), page, more: page < (d.totalPages || 1) });
}
export async function search(q, kind = 'all') {
  if (provider() === 'ask') return keep(await ask(`/api/search?q=${encodeURIComponent(q)}&kind=${kind}`));
  const d = await seerr.search(q);
  let video = list(d);
  if (kind === 'movie') video = video.filter((x) => x.type === 'movie');
  if (kind === 'tv') video = video.filter((x) => x.type === 'tv' && !x.anime);
  if (kind === 'anime') video = video.filter((x) => x.anime);
  return keep({ query: q, video, reading: [] });
}
export async function title(type, id) {
  if (provider() === 'ask') return ask(`/api/title?type=${type}&id=${id}`);
  const d = type === 'movie' ? await seerr.movie(id) : await seerr.tv(id);
  const base = fromSeerr({ ...d, mediaType: type });
  const seasonStatus = new Map((d.mediaInfo?.seasons || []).map((s) => [s.seasonNumber, s.status]));
  return { ...base, genres: (d.genres || []).map((g) => g.name).slice(0, 4), runtime: d.runtime || d.episodeRunTime?.[0] || null, tagline: d.tagline || '',
    seasons: type === 'tv' ? (d.seasons || []).filter((s) => s.seasonNumber > 0).map((s) => ({ n: s.seasonNumber, name: s.name, episodes: s.episodeCount || 0, status: ST[seasonStatus.get(s.seasonNumber)] || 'none' })) : [] };
}
export const readingTitle = (x) => ask(`/api/reading-title?${new URLSearchParams({ key: x.key || '', type: x.type, title: x.title, workId: x.workId || '' })}`);
// payload: { type, id, seasons, profile } for video; the ask site's reading payloads for books/manga/comics
export async function request(payload) {
  if (provider() === 'ask') return ask('/api/request', { method: 'POST', body: payload });
  await seerr.request(payload.type, payload.id, payload.seasons);
  return { ok: true, status: 'pending', msg: 'Requested. It starts downloading once it is approved.' };
}
export async function mine() {
  if (provider() === 'ask') return ask('/api/mine');
  const d = await seerr.myRequests(60);
  const out = [];
  for (const r of d.results || []) {
    const type = r.type === 'movie' ? 'movie' : 'tv', tmdb = r.media?.tmdbId; if (!tmdb) continue;
    const t = await (type === 'movie' ? seerr.movie(tmdb) : seerr.tv(tmdb)).catch(() => ({}));
    const ms = r.media?.status;
    out.push({ key: `${type}:${tmdb}`, type, id: tmdb, title: t.title || t.name || 'Unknown', year: String(t.releaseDate || t.firstAirDate || '').slice(0, 4), poster: t.posterPath ? TMDB + 'w185' + t.posterPath : '',
      created: Date.parse(r.createdAt) || 0, seasons: (r.seasons || []).map((x) => x.seasonNumber), state: r.status === 3 ? 'declined' : ms === 5 ? 'available' : ms === 4 ? 'partial' : r.status === 1 ? 'pending' : 'requested' });
  }
  return { items: out };
}
export const STATUS = { none: '', pending: 'Waiting for approval', requested: 'Requested', partial: 'Partly here', available: 'Available', declined: 'Declined', approved: 'Approved', failed: 'Failed' };
