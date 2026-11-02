// Seerr (also works with Jellyseerr and Overseerr): find and request movies and shows.
import { http, settings, save } from './core.js';

const S = () => settings.servers.seerr;
const api = (path, opts) => http(S().url + '/api/v1' + path, opts);
export const ready = () => !!S()?.userId;
export const poster = (p, w = 342) => (p ? `https://image.tmdb.org/t/p/w${w}${p}` : '');
export const backdrop = (p) => (p ? `https://image.tmdb.org/t/p/w1280${p}` : '');

// Sign in with the Jellyfin account (how most people use Seerr), or a Seerr email account
export async function signIn(url, username, password, kind = 'jellyfin') {
  const status = await http(url + '/api/v1/status').catch(() => { throw new Error("That doesn't look like a Seerr server. Check the address."); });
  const user = kind === 'local'
    ? await http(url + '/api/v1/auth/local', { method: 'POST', body: { email: username, password } })
    : await http(url + '/api/v1/auth/jellyfin', { method: 'POST', body: { username, password } });
  settings.servers.seerr = { url, userId: user.id, name: user.displayName || user.jellyfinUsername || user.username || user.email, kind, version: status.version, permissions: user.permissions };
  save();
  return settings.servers.seerr;
}
export async function signOut() { try { await api('/auth/logout', { method: 'POST' }); } catch {} settings.servers.seerr = null; save(); }
// The Seerr sign-in is a cookie kept by the app. After an app restart it may be gone: sign in again quietly is not possible, so we ask.
export const me = () => api('/auth/me');

const q = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export const trending = (page = 1) => api(`/discover/trending?page=${page}&language=en`);
export const popularMovies = (page = 1) => api(`/discover/movies?page=${page}&language=en`);
export const popularTv = (page = 1) => api(`/discover/tv?page=${page}&language=en`);
export const anime = (page = 1) => api(`/discover/tv?page=${page}&language=en&keywords=210024`);
export const upcoming = (page = 1) => api(`/discover/movies/upcoming?page=${page}&language=en`);
export const search = (term, page = 1) => api(`/search?query=${q(term)}&page=${page}&language=en`);
export const movie = (id) => api(`/movie/${id}`);
export const tv = (id) => api(`/tv/${id}`);
export function request(mediaType, tmdbId, seasons) {
  const body = { mediaType, mediaId: Number(tmdbId) };
  if (mediaType === 'tv') body.seasons = seasons?.length ? seasons : 'all';
  return api('/request', { method: 'POST', body });
}
export const myRequests = (take = 40) => api(`/request?take=${take}&skip=0&sort=added&filter=all&requestedBy=${S().userId}`);
export const cancelRequest = (id) => api(`/request/${id}`, { method: 'DELETE' });
// Seerr media status: 1 unknown, 2 pending, 3 processing, 4 partly available, 5 available
export const STATUS = { 2: 'Requested', 3: 'Coming soon', 4: 'Partly here', 5: 'Available' };
// Request status: 1 pending approval, 2 approved, 3 declined
export const REQUEST = { 1: 'Waiting for approval', 2: 'Approved', 3: 'Declined', 4: 'Failed', 5: 'Done' };
