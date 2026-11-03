// Kavita: books, manga and comics. Sign in with a Kavita username and password.
import { http, settings, save, desktop } from './core.js';
import { browserWebLogin } from './web-login.js';

const S = () => settings.servers.kavita;
const api = (path, opts = {}) => http(S().url + path, { ...opts, headers: { ...(S().cookie ? {} : { Authorization: `Bearer ${S().token}` }), ...(opts.headers || {}) } });
export const ready = () => !!(S()?.token || S()?.cookie);

// With an API key (Kavita: your account, API Key / OPDS): works even if you normally
// sign in to Kavita with Jellyfin or another sign-in button
export async function signInWithKey(url, apiKey) {
  const r = await http(`${url}/api/Plugin/authenticate?apiKey=${encodeURIComponent(apiKey)}&pluginName=Zenith`, { method: 'POST' }).catch((e) => {
    throw new Error(e.status === 401 ? "Kavita didn't accept that API key." : e.status ? e.message : "Couldn't reach that Kavita server. Check the address.");
  });
  settings.servers.kavita = { url, token: r.token, refreshToken: r.refreshToken || '', apiKey: r.apiKey || apiKey, name: r.username || 'Kavita' };
  save();
  return settings.servers.kavita;
}
export async function signIn(url, username, password) {
  if (!username && /^[\w-]{20,}$/.test(password)) return signInWithKey(url, password);
  const r = await http(url + '/api/Account/login', { method: 'POST', body: { username, password } }).catch((e) => {
    throw new Error(e.status === 401 ? 'Wrong Kavita username or password.' : e.status ? e.message : "Couldn't reach that Kavita server. Check the address.");
  });
  settings.servers.kavita = { url, token: r.token, refreshToken: r.refreshToken, apiKey: r.apiKey, name: r.username };
  save();
  return settings.servers.kavita;
}
// Sign in on the Kavita website itself (desktop app): works with Kavita's single sign-on,
// such as its "Jellyfin" button. The app keeps the sign-in Kavita saves.
export async function signInWithWebsite(url) {
  const r = desktop?.webLogin ? await desktop.webLogin(url) : await browserWebLogin(url, async login => {
    const account = await http(url + '/api/Account', { headers: { Authorization: 'Bearer ' + login.token } });
    if (account.username !== login.username) throw new Error('Account mismatch');
    return login;
  });
  if (!r) throw new Error('Sign-in was closed before it finished.');
  settings.servers.kavita = { url, token: r.token, refreshToken: r.refreshToken, apiKey: r.apiKey, cookie: !!r.cookie, name: r.username || 'Kavita' };
  save();
  return settings.servers.kavita;
}
export function signOut() { settings.servers.kavita = null; save(); }
// Kavita tokens expire; refresh once when a request says we're signed out
async function call(path, opts) {
  try { return await api(path, opts); }
  catch (e) {
    if (e.status !== 401) throw e;
    // Expired: renew with the refresh token, or with the account's API key (lasts until it's reset in Kavita)
    let r = S()?.refreshToken ? await http(S().url + '/api/Account/refresh-token', { method: 'POST', body: { token: S().token, refreshToken: S().refreshToken } }).catch(() => null) : null;
    if (!r?.token && S()?.apiKey) r = await http(`${S().url}/api/Plugin/authenticate?apiKey=${encodeURIComponent(S().apiKey)}&pluginName=Zenith`, { method: 'POST' }).catch(() => null);
    if (!r?.token) throw e;
    Object.assign(S(), { token: r.token, refreshToken: r.refreshToken || S().refreshToken }); save();
    return api(path, opts);
  }
}

export const libraries = () => call('/api/Library/libraries');
export const onDeck = () => call('/api/Series/on-deck?PageNumber=1&PageSize=24&libraryId=0', { method: 'POST', body: {} }).catch(() => []);
export const recent = () => call('/api/Series/recently-added-v2?PageNumber=1&PageSize=24', { method: 'POST', body: {} }).catch(() => []);
export async function seriesIn(libraryId, page = 1, size = 60) {
  // Newer Kavita (0.8+): filter v2. Older: the plain list.
  const filter = { id: 0, name: '', statements: [{ comparison: 0, field: 19, value: String(libraryId) }], combination: 1, sortOptions: { sortField: 1, isAscending: true }, limitTo: 0 };
  try { return await call(`/api/Series/all-v2?PageNumber=${page}&PageSize=${size}`, { method: 'POST', body: filter }); }
  catch { return call(`/api/Series/all?libraryId=${libraryId}&PageNumber=${page}&PageSize=${size}`, { method: 'POST', body: {} }); }
}
export const search = (q) => call(`/api/Search/search?queryString=${encodeURIComponent(q)}&includeChapterAndFiles=false`);
export const series = (id) => call(`/api/Series/${id}`);
export const metadata = (id) => call(`/api/Series/metadata?seriesId=${id}`).catch(() => null);
export const volumes = (id) => call(`/api/Series/volumes?seriesId=${id}`);
export const continuePoint = (id) => call(`/api/Reader/continue-point?seriesId=${id}`).catch(() => null);
export const chapterInfo = (chapterId) => call(`/api/Reader/chapter-info?chapterId=${chapterId}&includeDimensions=false`);
export const getProgress = (chapterId) => call(`/api/Reader/get-progress?chapterId=${chapterId}`).catch(() => null);
export const saveProgress = (p) => call('/api/Reader/progress', { method: 'POST', body: p }).catch(() => {});
export const markRead = (seriesId) => call('/api/Reader/mark-read', { method: 'POST', body: { seriesId } });
export const markUnread = (seriesId) => call('/api/Reader/mark-unread', { method: 'POST', body: { seriesId } });
export const nextChapter = (seriesId, volumeId, chapterId) => call(`/api/Reader/next-chapter?seriesId=${seriesId}&volumeId=${volumeId}&currentChapterId=${chapterId}`).catch(() => -1);
export const prevChapter = (seriesId, volumeId, chapterId) => call(`/api/Reader/prev-chapter?seriesId=${seriesId}&volumeId=${volumeId}&currentChapterId=${chapterId}`).catch(() => -1);
export const bookInfo = (chapterId) => call(`/api/Book/${chapterId}/book-info`);
export const bookChapters = (chapterId) => call(`/api/Book/${chapterId}/chapters`).catch(() => []);
export const bookPage = (chapterId, page) => call(`/api/Book/${chapterId}/book-page?page=${page}`);

export const cover = (seriesId) => `${S().url}/api/Image/series-cover?seriesId=${seriesId}&apiKey=${S().apiKey}`;
export const chapterCover = (chapterId) => `${S().url}/api/Image/chapter-cover?chapterId=${chapterId}&apiKey=${S().apiKey}`;
export const volumeCover = (volumeId) => `${S().url}/api/Image/volume-cover?volumeId=${volumeId}&apiKey=${S().apiKey}`;
export const pageImage = (chapterId, page) => `${S().url}/api/Reader/image?chapterId=${chapterId}&page=${page}&apiKey=${S().apiKey}&extractPdf=true`;
// Kavita format numbers: 0 image, 1 archive (comic/manga), 2 unknown, 3 epub, 4 pdf
export const isBook = (format) => format === 3;
