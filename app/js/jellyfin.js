// Jellyfin: sign-in, libraries, items, playback info and progress reports.
import { http, settings, save, deviceId, VERSION, desktop } from './core.js';

import { groups } from './core.js';
const S = () => groups.srv('jellyfin');
// The server an item came from (lists from every server are tagged with their group)
const SI = (it) => (it?._g && groups.byId(it._g)?.servers?.jellyfin) || S();
const CLIENT = desktop ? 'Zenith Desktop' : 'Zenith Web';
const DEVICE = desktop ? (navigator.userAgentData?.platform || 'Desktop') : 'Browser';
const authHeader = (token) => `MediaBrowser Client="${CLIENT}", Device="${DEVICE}", DeviceId="${deviceId}", Version="${VERSION}"${token ? `, Token="${token}"` : ''}`;
const api = (path, opts = {}) => http(S().url + path, { ...opts, headers: { Authorization: authHeader(S().token), ...(opts.headers || {}) } });
export const ready = () => !!S()?.token;

export async function publicInfo(url) { return http(url + '/System/Info/Public'); }
export async function signIn(url, username, password) {
  const info = await publicInfo(url).catch(() => { throw new Error("That doesn't look like a Jellyfin server. Check the address."); });
  const r = await http(url + '/Users/AuthenticateByName', { method: 'POST', headers: { Authorization: authHeader() }, body: { Username: username, Pw: password } }).catch((error) => { if (error.status === 401) error.message = 'Jellyfin did not accept that username or password.'; throw error; });
  settings.servers.jellyfin = { url, token: r.AccessToken, userId: r.User.Id, name: r.User.Name, server: info.ServerName, admin: !!r.User.Policy?.IsAdministrator, serverId: info.Id };
  save();
  return settings.servers.jellyfin;
}
// Quick Connect: show a code, the user approves it from another signed-in device
export async function quickConnectStart(url) {
  const ok = await http(url + '/QuickConnect/Enabled').catch(() => false);
  if (!ok) throw new Error('Quick Connect is turned off on this server.');
  return http(url + '/QuickConnect/Initiate', { method: 'POST', headers: { Authorization: authHeader() } });
}
export async function quickConnectPoll(url, secret) {
  const s = await http(`${url}/QuickConnect/Connect?Secret=${encodeURIComponent(secret)}`);
  if (!s.Authenticated) return null;
  const info = await publicInfo(url);
  const r = await http(url + '/Users/AuthenticateWithQuickConnect', { method: 'POST', headers: { Authorization: authHeader() }, body: { Secret: secret } });
  settings.servers.jellyfin = { url, token: r.AccessToken, userId: r.User.Id, name: r.User.Name, server: info.ServerName, admin: !!r.User.Policy?.IsAdministrator, serverId: info.Id };
  save();
  return settings.servers.jellyfin;
}
export async function signOut() { try { await api('/Sessions/Logout', { method: 'POST' }); } catch {} settings.servers.jellyfin = null; save(); }

const FIELDS = 'PrimaryImageAspectRatio,Overview,Genres,CommunityRating,OfficialRating,ProductionYear,RunTimeTicks,UserData,ChildCount,SeriesInfo,ParentId,ImageTags,BackdropImageTags,ParentBackdropImageTags,SeriesPrimaryImageTag,EndDate,Status';
const U = () => `/Users/${S().userId}`;
export const views = () => api(`${U()}/Views`).then((r) => r.Items || []);
export const resume = (limit = 16) => api(`${U()}/Items/Resume?Limit=${limit}&MediaTypes=Video&Fields=${FIELDS}&EnableImageTypes=Primary,Backdrop,Thumb`).then((r) => r.Items || []);
export const nextUp = (limit = 16, seriesId = '') => api(`/Shows/NextUp?UserId=${S().userId}&Limit=${limit}&Fields=${FIELDS}${seriesId ? `&SeriesId=${seriesId}` : ''}&EnableResumable=false&EnableRewatching=${settings.app.rewatch !== false}`).then((r) => r.Items || []);
export const latest = (parentId, limit = 18) => api(`${U()}/Items/Latest?ParentId=${parentId}&Limit=${limit}&Fields=${FIELDS}&GroupItems=true`);
export const item = (id) => api(`${U()}/Items/${id}?Fields=${FIELDS},People,MediaSources,MediaStreams,Chapters,Studios,Taglines,ExternalUrls,RemoteTrailers,Trickplay`);
export const similar = (id) => api(`/Items/${id}/Similar?UserId=${S().userId}&Limit=12&Fields=${FIELDS}`).then((r) => r.Items || []);
export const seasons = (seriesId) => api(`/Shows/${seriesId}/Seasons?UserId=${S().userId}&Fields=${FIELDS}`).then((r) => r.Items || []);
export const episodes = (seriesId, seasonId) => api(`/Shows/${seriesId}/Episodes?UserId=${S().userId}&SeasonId=${seasonId}&Fields=${FIELDS},MediaSources,Trickplay`).then((r) => r.Items || []);
export const allEpisodes = (seriesId) => api(`/Shows/${seriesId}/Episodes?UserId=${S().userId}&Fields=${FIELDS}`).then((r) => r.Items || []);
export function items({ parentId = '', types = '', sort = 'SortName', order = 'Ascending', start = 0, limit = 60, filters = '', genres = '', search = '', recursive = true, years = '' } = {}) {
  const q = new URLSearchParams({ Recursive: recursive, Fields: FIELDS, SortBy: sort, SortOrder: order, StartIndex: start, Limit: limit, EnableImageTypes: 'Primary,Backdrop,Thumb', ImageTypeLimit: 1 });
  if (parentId) q.set('ParentId', parentId);
  if (types) q.set('IncludeItemTypes', types);
  if (filters) q.set('Filters', filters);
  if (genres) q.set('Genres', genres);
  if (years) q.set('Years', years);
  if (search) q.set('SearchTerm', search);
  return api(`${U()}/Items?${q}`);
}
export const byPerson = (personId) => api(`${U()}/Items?PersonIds=${personId}&Recursive=true&IncludeItemTypes=Movie,Series&SortBy=PremiereDate&SortOrder=Descending&Fields=${FIELDS}`);
export const genres = (parentId) => api(`/Genres?UserId=${S().userId}&ParentId=${parentId}&SortBy=SortName`).then((r) => r.Items || []);
export const search = (term) => items({ search: term, types: 'Movie,Series,Episode,BoxSet,MusicAlbum,Audio,Person', limit: 40, sort: 'SortName' });
export const setWatched = (id, on) => api(`${U()}/PlayedItems/${id}`, { method: on ? 'POST' : 'DELETE' });
export const setFavorite = (id, on) => api(`${U()}/FavoriteItems/${id}`, { method: on ? 'POST' : 'DELETE' });
export const intro = (id) => api(`/Episode/${id}/IntroTimestamps`).catch(() => null); // Intro Skipper plugin, if installed
export const segments = (id) => api(`/MediaSegments/${id}`).then((r) => r.Items || []).catch(() => []); // Jellyfin 10.10+

// Images
export function img(it, type = 'Primary', w = 400) {
  if (!it) return '';
  const base = SI(it).url;
  if (type === 'Backdrop') {
    if (it.BackdropImageTags?.length) return `${base}/Items/${it.Id}/Images/Backdrop?tag=${it.BackdropImageTags[0]}&maxWidth=${w}&quality=85`;
    if (it.ParentBackdropImageTags?.length) return `${base}/Items/${it.ParentBackdropItemId}/Images/Backdrop?tag=${it.ParentBackdropImageTags[0]}&maxWidth=${w}&quality=85`;
    return '';
  }
  if (type === 'Thumb') {
    if (it.ImageTags?.Thumb) return `${base}/Items/${it.Id}/Images/Thumb?tag=${it.ImageTags.Thumb}&maxWidth=${w}&quality=85`;
    if (it.Type === 'Episode' && it.ImageTags?.Primary) return `${base}/Items/${it.Id}/Images/Primary?tag=${it.ImageTags.Primary}&maxWidth=${w}&quality=85`;
    return img(it, 'Backdrop', w);
  }
  if (it.ImageTags?.Primary) return `${base}/Items/${it.Id}/Images/Primary?tag=${it.ImageTags.Primary}&maxWidth=${w}&quality=88`;
  if (it.SeriesPrimaryImageTag) return `${base}/Items/${it.SeriesId}/Images/Primary?tag=${it.SeriesPrimaryImageTag}&maxWidth=${w}&quality=88`;
  if (it.AlbumPrimaryImageTag) return `${base}/Items/${it.AlbumId}/Images/Primary?tag=${it.AlbumPrimaryImageTag}&maxWidth=${w}`;
  return '';
}
export const personImg = (p, w = 200) => p.PrimaryImageTag ? `${SI(p).url}/Items/${p.Id}/Images/Primary?tag=${p.PrimaryImageTag}&maxWidth=${w}&quality=85` : '';
export const trickplayUrl = (id, width, index, sourceId) => `${S().url}/Videos/${id}/Trickplay/${width}/${index}.jpg?api_key=${S().token}&MediaSourceId=${sourceId}`;

// ── Playback ───────────────────────────────────────────────────────────
// What this app can play directly. Anything else is converted by the server (HLS).
function deviceProfile(maxBitrate) {
  const v = document.createElement('video');
  const can = (t) => !!v.canPlayType(t).replace('no', '');
  const vcodecs = ['h264', ...(can('video/mp4; codecs="hvc1.1.6.L93.B0"') ? ['hevc'] : []), ...(can('video/webm; codecs="vp9"') ? ['vp9'] : []), ...(can('video/mp4; codecs="av01.0.05M.08"') ? ['av1'] : []), 'vp8'];
  const acodecs = ['aac', 'mp3', 'opus', 'flac', 'vorbis', ...(can('audio/mp4; codecs="ac-3"') ? ['ac3'] : []), ...(can('audio/mp4; codecs="ec-3"') ? ['eac3'] : [])];
  return {
    MaxStreamingBitrate: maxBitrate || 200_000_000, MaxStaticBitrate: maxBitrate || 200_000_000, MusicStreamingTranscodingBitrate: 384000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v,mov', Type: 'Video', VideoCodec: vcodecs.join(','), AudioCodec: acodecs.join(',') },
      { Container: 'mkv', Type: 'Video', VideoCodec: vcodecs.join(','), AudioCodec: acodecs.join(',') },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' },
      { Container: 'mp3,aac,m4a,flac,ogg,opus,wav,webma', Type: 'Audio' },
    ],
    TranscodingProfiles: [
      { Container: 'ts', Type: 'Video', AudioCodec: 'aac,mp3', VideoCodec: vcodecs.filter((c) => ['h264', 'hevc'].includes(c)).join(','), Context: 'Streaming', Protocol: 'hls', MaxAudioChannels: '6', MinSegments: '1', BreakOnNonKeyFrames: true },
      { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Context: 'Streaming', Protocol: 'http' },
    ],
    ContainerProfiles: [], CodecProfiles: [],
    SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }, { Format: 'srt', Method: 'External' }, { Format: 'ass', Method: 'External' }, { Format: 'ssa', Method: 'External' }, { Format: 'pgssub', Method: 'Encode' }, { Format: 'dvdsub', Method: 'Encode' }],
  };
}
// Returns { url, hls, source, playSessionId, method, subtitles[], audio[] }
// clientAudio: the player can switch audio tracks itself, so a non-default track can still play the original file
export async function playback(id, { audioIndex, subIndex, start = 0, maxBitrate, forceTranscode = false, sourceId, clientAudio = false, burnSub = false } = {}) {
  const p = settings.playback;
  const bitrate = maxBitrate ?? p.maxBitrate;
  const body = {
    UserId: S().userId, DeviceProfile: deviceProfile(bitrate), StartTimeTicks: Math.round(start * 1e7), AutoOpenLiveStream: true, MediaSourceId: sourceId || undefined,
    EnableDirectPlay: !forceTranscode && p.directPlay, EnableDirectStream: !forceTranscode, EnableTranscoding: true, AllowVideoStreamCopy: !forceTranscode, AllowAudioStreamCopy: !forceTranscode,
    ...(audioIndex != null ? { AudioStreamIndex: audioIndex } : {}), ...(subIndex != null && burnSub ? { SubtitleStreamIndex: subIndex } : {}), ...(bitrate ? { MaxStreamingBitrate: bitrate } : {}),
  };
  const info = await api(`/Items/${id}/PlaybackInfo?UserId=${S().userId}`, { method: 'POST', body });
  if (info.ErrorCode) throw new Error(info.ErrorCode === 'NotAllowed' ? "You're not allowed to play this." : `The server can't play this (${info.ErrorCode}).`);
  const src = info.MediaSources?.[0];
  if (!src) throw new Error('This item has no playable file.');
  const base = S().url, token = S().token;
  let url, hls = false, method;
  const audioOk = audioIndex == null || clientAudio || audioIndex === src.DefaultAudioStreamIndex;
  if (src.SupportsDirectPlay && p.directPlay && !forceTranscode && audioOk && !burnSub) {
    method = 'Direct play';
    url = `${base}/Videos/${id}/stream?static=true&MediaSourceId=${src.Id}&PlaySessionId=${info.PlaySessionId}&api_key=${token}&DeviceId=${deviceId}`;
  } else if (src.SupportsDirectStream && !forceTranscode && audioOk && !burnSub) {
    method = 'Direct stream';
    url = `${base}/Videos/${id}/stream.${src.Container}?static=true&MediaSourceId=${src.Id}&PlaySessionId=${info.PlaySessionId}&api_key=${token}&DeviceId=${deviceId}`;
  } else if (src.TranscodingUrl) {
    method = 'Converting on the server';
    url = base + src.TranscodingUrl; hls = /m3u8/.test(src.TranscodingUrl);
  } else throw new Error('The server could not prepare this video.');
  const streams = src.MediaStreams || [];
  const subtitles = streams.filter((s) => s.Type === 'Subtitle').map((s) => ({
    index: s.Index, label: s.DisplayTitle || s.Language || `Track ${s.Index}`, lang: s.Language || '', forced: !!s.IsForced, isDefault: !!s.IsDefault, external: !!s.IsExternal,
    textBased: s.IsTextSubtitleStream, url: s.IsTextSubtitleStream ? `${base}/Videos/${id}/${src.Id}/Subtitles/${s.Index}/0/Stream.vtt?api_key=${token}` : '',
  }));
  const audio = streams.filter((s) => s.Type === 'Audio').map((s) => ({ index: s.Index, label: s.DisplayTitle || s.Language || `Track ${s.Index}`, lang: s.Language || '', isDefault: !!s.IsDefault }));
  const video = streams.find((s) => s.Type === 'Video');
  return { url, hls, method, source: src, playSessionId: info.PlaySessionId, subtitles, audio, video, defaultAudio: src.DefaultAudioStreamIndex, defaultSub: src.DefaultSubtitleStreamIndex };
}
const ticks = (s) => Math.round((s || 0) * 1e7);
export const reportStart = (it, pb, pos) => api('/Sessions/Playing', { method: 'POST', body: { ItemId: it.Id, MediaSourceId: pb.source.Id, PlaySessionId: pb.playSessionId, PositionTicks: ticks(pos), CanSeek: true, PlayMethod: pb.method === 'Direct play' ? 'DirectPlay' : pb.method === 'Direct stream' ? 'DirectStream' : 'Transcode' } }).catch(() => {});
export const reportProgress = (it, pb, pos, paused) => api('/Sessions/Playing/Progress', { method: 'POST', body: { ItemId: it.Id, MediaSourceId: pb.source.Id, PlaySessionId: pb.playSessionId, PositionTicks: ticks(pos), IsPaused: !!paused, CanSeek: true, EventName: 'timeupdate' } }).catch(() => {});
export const reportStop = (it, pb, pos) => api('/Sessions/Playing/Stopped', { method: 'POST', body: { ItemId: it.Id, MediaSourceId: pb.source.Id, PlaySessionId: pb.playSessionId, PositionTicks: ticks(pos) } }).catch(() => {});
export const stopTranscode = (pb) => api(`/Videos/ActiveEncodings?DeviceId=${deviceId}&PlaySessionId=${pb.playSessionId}`, { method: 'DELETE' }).catch(() => {});
export const downloadUrl = (id) => `${S().url}/Items/${id}/Download?api_key=${S().token}`;
