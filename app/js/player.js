// The video player: our own controls, subtitles, audio tracks, quality, speed,
// chapters, skip intro, next episode, picture in picture and the mini player.
import { $, esc, icon, fmtTime, settings, save, desktop, toast, emit, http, groups } from './core.js';
import * as jf from './jellyfin.js';
import {attachNativeAudio, audioMuted, setAudioMuted} from './native-audio.js';
import {playbackFailure} from './playback-errors.js';
import {openNativeVideo, nativeTrackId, waitNativeVideo, parseNativeCues, nativeCueText} from './native-video.js';
import { pickAudio, pickSub, applySubStyle, cueHtml } from './tracks.js';

// Electron can switch audio tracks inside the original file (no server work needed)
const canSwitchAudio = typeof HTMLMediaElement !== 'undefined' && 'audioTracks' in HTMLMediaElement.prototype;
// Tracks as listed in the item, before asking the server for a stream
function listTracks(item) {
  const st = item.MediaSources?.[0]?.MediaStreams || [];
  return {
    audio: st.filter((s) => s.Type === 'Audio').map((s) => ({ index: s.Index, label: s.DisplayTitle || s.Language || '', lang: s.Language || '', isDefault: !!s.IsDefault })),
    subs: st.filter((s) => s.Type === 'Subtitle').map((s) => ({ index: s.Index, label: s.DisplayTitle || s.Language || '', lang: s.Language || '', forced: !!s.IsForced, isDefault: !!s.IsDefault, textBased: !!s.IsTextSubtitleStream })),
    defaultAudio: item.MediaSources?.[0]?.DefaultAudioStreamIndex,
  };
}

const root = () => $('#player');
let S = null; // the current session

const SPEEDS = [0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2];
const QUALITIES = [[0, 'Original file · direct play']];

export const isOpen = () => !!S;

// Open an item. queue: episodes that follow (for next episode and the episode list)
export async function play(item, { start, queue = [] } = {}) {
  if (S) await close(true);
  // Play from the server the item lives on, and keep talking to that one
  if (item?._g) groups.use(item._g);
  const gid = groups.active().id;
  const full = item.MediaSources ? item : await jf.item(item.Id);
  const resumeAt = start ?? (full.UserData?.PlaybackPositionTicks ? full.UserData.PlaybackPositionTicks / 1e7 : 0);
  S = { g: gid, item: full, queue, pb: null, hls: null, sub: null, audio: null, quality: 0, offset: 0, reported: 0, menu: null, segments: [], introShown: false, nextShown: false, startedAt: Date.now() };
  // Your languages first: English audio when there is any, otherwise English subtitles (Settings > Playback)
  const tr = listTracks(full);
  S.audio = pickAudio(tr.audio, tr.defaultAudio);
  // Picked on the info page just before pressing play
  const pre = (await import('./watch.js')).prePick;
  if (pre && pre.group === gid && (pre.for === full.Id || pre.for === full.SeriesId)) {
    // Direct play always keeps the original file quality.
    if (pre.audio != null && pre.audio !== '') {
      const byIndex = tr.audio.find((a) => String(a.index) === String(pre.audio));
      const byLang = tr.audio.find((a) => a.lang && a.lang === pre.audio);
      if (byIndex || byLang) S.audio = (byIndex || byLang).index;
    }
  }
  S.sub = pickSub(tr.subs, tr.audio.find((a) => a.index === S.audio));
  if (pre && pre.group === gid && (pre.for === full.Id || pre.for === full.SeriesId) && pre.sub && pre.sub !== 'auto') {
    if (pre.sub === 'off') S.sub = null;
    else if (pre.sub.startsWith('lang:')) { const l = pre.sub.slice(5); const m = tr.subs.filter((x) => x.lang === l && !x.forced); S.sub = (m.find((x) => x.textBased) || m[0])?.index ?? S.sub; }
    else if (tr.subs.some((x) => String(x.index) === pre.sub)) S.sub = Number(pre.sub);
  }
  S.subTextOk = S.sub == null || !!tr.subs.find((x) => x.index === S.sub)?.textBased;
  S.forceTranscode = false;
  S.trackKnown = tr.audio.length + tr.subs.length > 0;
  document.body.classList.add('playing');
  build();
  if (!queue.length && full.Type === 'Episode') jf.allEpisodes(full.SeriesId).then((eps) => { if (S?.item.Id === full.Id) { const i = eps.findIndex((e) => e.Id === full.Id); S.queue = eps.slice(i + 1); S.list = eps; } }).catch(() => {});
  loadSegments(full);
  await load(resumeAt);
}

function build() {
  const el = root();
  const it = S.item;
  const title = it.Type === 'Episode' ? it.SeriesName : it.Name;
  const sub = it.Type === 'Episode' ? `S${it.ParentIndexNumber ?? '?'} E${it.IndexNumber ?? '?'} · ${it.Name}` : [it.ProductionYear, it.OfficialRating].filter(Boolean).join(' · ');
  el.hidden = false;
  el.innerHTML = `<video playsinline preload="auto"></video>
  <div class="pl-subs"><div class="pl-subs-in"></div></div>
  <div class="pl-center"><div class="spinner"></div></div>
  <button class="pl-resume" data-p="toggle" aria-label="Resume playback" title="Resume playback (Space)" hidden>${icon('play')}<span>Resume</span></button>
  <div class="pl-flash"></div>
  <div class="pl-ui">
    <div class="pl-top">
      <button class="pl-btn" data-p="close" title="Back (Esc)">${icon('back')}</button>
      <div class="pl-title"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
      ${desktop ? `<button class="pl-btn" data-p="mini" title="Mini player, always on top (M)">${icon('pin')}</button>` : ''}
    </div>
    <div class="pl-bottom">
      <div class="pl-seek"><div class="track"><div class="buf"></div><div class="done"></div><div class="knob"></div></div><div class="pl-segments" aria-hidden="true"></div></div>
      <div class="pl-row">
        <button class="pl-btn hide-mini" data-p="prev" title="Previous episode" hidden>${icon('prev')}</button>
        <button class="pl-btn hide-mini" data-p="back10" title="Back 10 seconds (Left)">${icon('skipb')}<span class="tag">10</span></button>
        <button class="pl-btn play" data-p="toggle" title="Play / pause (Space)">${icon('play')}</button>
        <button class="pl-btn hide-mini" data-p="fwd30" title="Forward 30 seconds (Right)">${icon('skipf')}<span class="tag">30</span></button>
        <button class="pl-btn" data-p="next" title="Next episode (N)" hidden>${icon('nextep')}</button>
        <div class="pl-vol"><button class="pl-btn" data-p="mute" title="Mute (M)">${icon('volume')}</button><input type="range" min="0" max="1" step="0.02" aria-label="Volume"></div>
        <span class="pl-time">0:00 / 0:00</span>
        <span class="spacer"></span>
        <button class="pl-btn hide-mini" data-p="episodes" title="Episodes" hidden>${icon('list')}</button>
        <button class="pl-btn" data-p="subs" title="Subtitles (C)">${icon('subs')}</button>
        <button class="pl-btn" data-p="settings" title="Audio, quality and speed">${icon('settings')}</button>
        <button class="pl-btn" data-p="pip" title="Picture in picture (P)">${icon('pip')}</button>
        <button class="pl-btn hide-mini" data-p="fullscreen" title="Full screen (F)">${icon('expand')}</button>
      </div>
    </div>
  </div>`;
  const v = $('video', el);
  S.nativeAudioWanted = !!desktop && /Win/i.test(navigator.platform) && settings.playback.nativeAudio !== false;
  if (S.nativeAudioWanted) v.crossOrigin = 'anonymous';
  v.volume = settings.playback.volume; v.playbackRate = settings.playback.rate;
  applySubStyle(el);
  S.v = v;
  // Events
  v.addEventListener('timeupdate', tick);
  v.addEventListener('progress', paintBuffer);
  v.addEventListener('waiting', () => spin(true));
  v.addEventListener('playing', () => { spin(false); paintPlay(); });
  v.addEventListener('canplay', () => spin(false));
  v.addEventListener('pause', () => { paintPlay(); report(true); discord(); });
  v.addEventListener('play', () => { paintPlay(); discord(); });
  v.addEventListener('ended', ended);
  v.addEventListener('volumechange', () => { settings.playback.volume = v.volume; save(); paintVolume(); });
  v.addEventListener('error', () => {
    if (!S || S.v !== v) return;
    // A server without CORS can still direct play normally; skip only native audio.
    if (v.crossOrigin && !S.audioCorsRetried) {
      S.audioCorsRetried = true; S.nativeAudioWanted = false;
      S.audioOut?.stop(); v.removeAttribute('crossorigin');
      toast('Retrying the original file with standard audio.');
      return load(pos());
    }
    if (!S.hls) fail(v.error);
  });
  v.addEventListener('enterpictureinpicture', () => $('[data-p=pip]', el).classList.add('on'));
  v.addEventListener('leavepictureinpicture', () => $('[data-p=pip]', el).classList.remove('on'));
  el.ondblclick = (e) => { if (!e.target.closest('.pl-top,.pl-bottom,.pl-menu,.pl-next,.pl-skip,.pl-error,input,a')) fullscreen(); };
  el.onclick = onClick;
  el.onmousemove = wake;
  el.ontouchstart = wake;
  $('.pl-vol input', el).oninput = (e) => { v.volume = Number(e.target.value); setAudioMuted(v, false); paintVolume(); };
  setupSeek();
  paintVolume();
  wake();
  // Media Session: OS media controls, lock screen, headset buttons
  if ('mediaSession' in navigator) {
    const it = S.item;
    navigator.mediaSession.metadata = new MediaMetadata({ title: it.Name, artist: it.SeriesName || '', album: it.SeasonName || '', artwork: [{ src: jf.img(it, 'Primary', 512), sizes: '512x512' }].filter((a) => a.src) });
    const h = { play: () => v.play(), pause: () => v.pause(), seekbackward: () => seekBy(-10), seekforward: () => seekBy(30), nexttrack: () => nextEpisode(), previoustrack: () => prevEpisode(), seekto: (d) => seekTo(d.seekTime) };
    for (const [k, fn] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch {} }
  }
}

// Load (or reload) the stream at a position, with the current track and quality choices
async function load(at = 0) {
  const session = S;
  if (!session) return;
  const epoch = session.loadEpoch = (session.loadEpoch || 0) + 1;
  session.nativeAbort?.abort();
  const previousNative = session.native;
  session.native = null;
  if (previousNative) await previousNative.destroy();
  if (S !== session || session.loadEpoch !== epoch) return;
  const nativeAbort = session.nativeAbort = desktop?.nativeVideo ? new AbortController() : null;
  groups.use(S.g);
  S.audioOut?.stop();
  const v = S.v;
  spin(true);
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  if (S.pb?.hls) jf.stopTranscode(S.pb);
  let pb;
  try {
    pb = await jf.playback(S.item.Id, { audioIndex: S.audio, subIndex: S.sub ?? undefined, burnSub: !desktop?.nativeVideo && S.sub != null && !S.subTextOk, clientAudio: canSwitchAudio || !!desktop?.nativeVideo, start: at, maxBitrate: S.quality, forceTranscode: S.forceTranscode });
  } catch (e) { if (S === session && session.loadEpoch === epoch) return fail(e); return; }
  if (S !== session || session.loadEpoch !== epoch) return;
  S.pb = pb;
  // The item didn't list its tracks: choose now from what the server sent
  if (!S.trackKnown) {
    S.trackKnown = true;
    const a = pickAudio(pb.audio, pb.defaultAudio);
    S.sub = pickSub(pb.subtitles, pb.audio.find((x) => x.index === a));
    S.subTextOk = S.sub == null || !!pb.subtitles.find((x) => x.index === S.sub)?.textBased;
    const was = S.audio; S.audio = a;
    if ((a !== (was ?? pb.defaultAudio) && (pb.hls || (!canSwitchAudio && !desktop?.nativeVideo))) || (!S.subTextOk && !desktop?.nativeVideo)) return load(at);
  }
  // A converted stream starts at the requested time; a direct file starts at 0
  S.offset = pb.hls ? at : 0;
  if (S.audio == null) S.audio = pb.defaultAudio ?? pb.audio[0]?.index ?? null;
  if (desktop?.nativeVideo) {
    try {
      const controller = await openNativeVideo(v, {url:pb.url, signal:nativeAbort.signal,
        controls:[...root().children, document.getElementById('toasts')].filter(e=>e && e!==v)});
      if (S !== session || session.loadEpoch !== epoch) { await controller.destroy(); return; }
      session.native = controller;
      controller.on('error', e => { if (S === session && session.loadEpoch === epoch) fail(e.detail); });
      spin(true);
      await waitNativeVideo(v, nativeAbort.signal);
      if (S !== session || session.loadEpoch !== epoch) return;
      if (at) await controller.seek(at);
      if (settings.playback.rate !== 1) await controller.setPlaybackRate(settings.playback.rate);
      await pickNativeAudio();
    } catch (e) { if (S === session && session.loadEpoch === epoch && !nativeAbort.signal.aborted) return fail(e); return; }
  } else if (pb.hls) {
    if (window.Hls?.isSupported()) {
      const hls = new window.Hls({ maxBufferLength: 60, backBufferLength: 60, startPosition: 0 });
      S.hls = hls;
      hls.on(window.Hls.Events.ERROR, (e, d) => { if (d.fatal) { if (d.type === 'networkError') hls.startLoad(); else if (d.type === 'mediaError') hls.recoverMediaError(); else fail(new Error('The stream stopped. Try a lower quality.')); } });
      // Most servers send the whole episode in the playlist (it starts at 0, not at the resume point):
      // then jump to the resume point ourselves, or it starts from the beginning while the bar says otherwise
      hls.once(window.Hls.Events.LEVEL_LOADED, (e, d) => {
        if (!S || S.hls !== hls || !at) return;
        const total = d.details?.totalduration || 0, full = S.item.RunTimeTicks ? S.item.RunTimeTicks / 1e7 : 0;
        if (full && total > full - at + 30) { S.offset = 0; v.currentTime = at; applySubtitles(); }
      });
      hls.loadSource(pb.url); hls.attachMedia(v);
    } else { v.src = pb.url; v.addEventListener('loadedmetadata', () => { if (at && S?.item.RunTimeTicks && v.duration > S.item.RunTimeTicks / 1e7 - at + 30) { S.offset = 0; v.currentTime = at; applySubtitles(); } }, { once: true }); } // Safari plays HLS natively
  } else {
    v.src = pb.url;
    v.addEventListener('loadedmetadata', () => { if (at) v.currentTime = at; pickFileAudio(); }, { once: true });
  }
  S.audioOut = attachNativeAudio(v, desktop, S.nativeAudioWanted);
  v.play().catch(() => paintPlay());
  applySubtitles();
  paintButtons();
  jf.reportStart(S.item, pb, at);
  emit('player', { open: true, item: S.item });
  discord();
}

// Original file playing: turn on the chosen audio track inside it
function pickFileAudio() {
  const v = S?.v; if (!v?.audioTracks || !S.pb || S.pb.hls) return;
  const k = S.pb.audio.findIndex((a) => a.index === S.audio);
  if (k < 0 || k >= v.audioTracks.length) return;
  for (let i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = i === k;
}
async function pickNativeAudio() {
  const session = S; if (!session?.native || !session.pb) return;
  const id = nativeTrackId(session.native, 'audio', session.audio, session.pb.audio);
  if (id) await session.native.selectTrack('audio', id);
}
// Subtitles: text tracks load as <track> and are drawn by us (so they can be styled);
// image subtitles need the server to burn them in
function applySubtitles() {
  const v = S.v;
  for (const t of [...v.querySelectorAll('track')]) t.remove();
  const box = $('.pl-subs-in', root()); if (box) box.innerHTML = '';
  S.nativeCues = [];
  const pb = S.pb;
  if (S.sub === undefined) {
    // First load: pick from settings (auto = server default, or forced tracks)
    const pref = settings.playback.subtitles;
    const byLang = settings.playback.subLang ? pb.subtitles.find((s) => s.lang === settings.playback.subLang) : null;
    S.sub = pref === 'off' ? null : pref === 'always' ? (byLang || pb.subtitles[0])?.index ?? null : pb.defaultSub >= 0 ? pb.defaultSub : pb.subtitles.find((s) => s.forced)?.index ?? null;
  }
  const s = pb.subtitles.find((x) => x.index === S.sub);
  if (S.native) {
    const id = s && !s.textBased ? nativeTrackId(S.native, 'subtitle', S.sub, pb.subtitles) : undefined;
    S.native.selectTrack('subtitle', id).catch(() => toast("Couldn't select those subtitles.", 'bad'));
    if (s?.textBased && s.url) {
      const session = S, want = S.sub, epoch = S.loadEpoch;
      http(s.url, {headers:{Accept:'text/vtt,*/*'}}).then(text => {
        if (S !== session || S.sub !== want || S.loadEpoch !== epoch || typeof text !== 'string') return;
        S.nativeCues = parseNativeCues(text);
        paintNativeSubtitles();
      }).catch(() => { if (S === session) toast("Couldn't load those subtitles.", 'bad'); });
    }
    return;
  }
  if (!s) return;
  if (!s.textBased) { if (!S.subTextOk) { S.subTextOk = false; } return; }
  const tr = document.createElement('track');
  tr.kind = 'subtitles'; tr.label = s.label; tr.srclang = s.lang || 'en'; tr.default = true;
  // Fetched through the app (servers rarely allow cross-site subtitle loads), then handed to the video
  const want = S.sub;
  http(s.url + (S.offset ? `&StartPositionTicks=${Math.round(S.offset * 1e7)}` : ''), { headers: { Accept: 'text/vtt,*/*' } }).then((text) => {
    if (!S || S.sub !== want || typeof text !== 'string') return;
    if (S.subUrl) URL.revokeObjectURL(S.subUrl);
    S.subUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
    tr.src = S.subUrl;
  }).catch(() => toast("Couldn't load those subtitles.", 'bad'));
  v.append(tr);
  const paint = () => { const cues = [...(tr.track.activeCues || [])]; box.innerHTML = cues.map((c) => `<span>${cueHtml(c.text)}</span>`).join('<br>'); };
  const hide = () => { tr.track.mode = 'hidden'; };
  tr.addEventListener('load', hide); setTimeout(hide, 50);
  tr.track.addEventListener('cuechange', paint);
}

const pos = () => (S ? S.offset + (S.v.currentTime || 0) : 0);
const duration = () => (S?.item.RunTimeTicks ? S.item.RunTimeTicks / 1e7 : (S?.v.duration || 0) + (S?.offset || 0));
function paintNativeSubtitles() {
  if (!S?.native) return;
  const box = $('.pl-subs-in', root());
  if (box) box.innerHTML = nativeCueText(S.nativeCues || [], pos()).map(text=>`<span>${cueHtml(text)}</span>`).join('<br>');
}

function tick() {
  if (!S) return;
  paintNativeSubtitles();
  const p = pos(), d = duration();
  $('.pl-time', root()).textContent = `${fmtTime(p)} / ${fmtTime(d)}`;
  $('.done', root()).style.width = d ? `${(p / d) * 100}%` : '0';
  $('.knob', root()).style.left = d ? `${(p / d) * 100}%` : '0';
  if (Date.now() - S.reported > 10000) report(false);
  // Skip intro / credits buttons
  const seg = S.segments.find((s) => p >= s.start && p < s.end - 1);
  const skip = $('.pl-skip', root());
  if (seg && !skip) {
    if (settings.playback.skipIntro && seg.type === 'Intro' && !S.introShown) { S.introShown = true; seekTo(seg.end); flash('Skipped the intro'); }
    else root().insertAdjacentHTML('beforeend', `<button data-air-video-controls class="btn gold pl-skip" data-p="skipseg">Skip ${seg.type === 'Outro' ? 'credits' : seg.type === 'Recap' ? 'recap' : 'intro'}</button>`);
  } else if (!seg && skip) skip.remove();
  // Up next, 30 seconds before the end (or at the credits)
  const next = S.queue[0];
  const credits = S.segments.find((s) => s.type === 'Outro');
  if (next && !S.nextShown && d && (p > d - 30 || (credits && p >= credits.start))) { S.nextShown = true; showNext(next); }
  if ('mediaSession' in navigator && d && Number.isFinite(d)) { try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(p, d), playbackRate: S.v.playbackRate }); } catch {} }
}
function paintBuffer() {
  const v = S?.v; if (!v?.buffered.length) return;
  const end = S.offset + v.buffered.end(v.buffered.length - 1), d = duration();
  $('.buf', root()).style.width = d ? `${Math.min(100, (end / d) * 100)}%` : '0';
}
function paintPlay() {
  if (!S) return;
  const el = root(), paused = S.v.paused;
  const b = $('.pl-btn.play', el);
  if (b) { b.innerHTML = icon(paused ? 'play' : 'pause'); b.setAttribute('aria-label', paused ? 'Play' : 'Pause'); }
  const resume = $('.pl-resume', el);
  if (resume) resume.hidden = !paused || !!S.loading || !!$('.pl-error', el) || !!S.menu || S.v.ended;
  el.classList.toggle('paused', paused);
  if (paused) el.classList.remove('idle');
}
function paintVolume() { const v = S?.v; if (!v) return; $('.pl-vol input', root()).value = audioMuted(v) ? 0 : v.volume; $('[data-p=mute]', root()).innerHTML = icon(audioMuted(v) || v.volume === 0 ? 'mute' : 'volume'); }
function paintButtons() {
  const el = root(), it = S.item;
  const ep = it.Type === 'Episode';
  $('[data-p=next]', el).hidden = !ep || !S.queue.length;
  $('[data-p=prev]', el).hidden = !ep;
  $('[data-p=episodes]', el).hidden = !ep;
  $('[data-p=subs]', el).classList.toggle('on', S.sub != null);
  $('[data-p=pip]', el).hidden = !document.pictureInPictureEnabled;
  // Chapter marks on the seek bar
  const d = duration(), track = $('.track', el);
  track.querySelectorAll('.chap,.seg').forEach((x) => x.remove());
  for (const c of it.Chapters || []) { const t = c.StartPositionTicks / 1e7; if (t > 1 && d) track.insertAdjacentHTML('beforeend', `<i class="chap" style="left:${(t / d) * 100}%"></i>`); }
  paintPlay();
  const markers = $('.pl-segments', el);
  markers.replaceChildren();
  for (const segment of S.segments) {
    const start = Math.max(0, Math.min(d, segment.start)), end = Math.max(start, Math.min(d, segment.end));
    if (d > 0 && end > start) markers.insertAdjacentHTML('beforeend', `<i class="seg" style="left:${(start / d) * 100}%;width:${((end - start) / d) * 100}%" title="${esc(segment.type)}"></i>`);
  }
}
const spin = (on) => { if (S) S.loading = on; const c = $('.pl-center', root()); if (c) c.hidden = !on; paintPlay(); };
let flashT;
function flash(text) { const f = $('.pl-flash', root()); if (!f) return; f.textContent = text; f.classList.add('show'); clearTimeout(flashT); flashT = setTimeout(() => f.classList.remove('show'), 900); }
let idleT;
function wake() { const el = root(); el.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (S && !S.v.paused && !S.menu) el.classList.add('idle'); }, 2600); }

// Seeking
function seekTo(t) {
  if (!S) return;
  const d = duration();
  t = Math.max(0, Math.min(d ? d - 1 : t, t));
  // In a converted stream, jumping outside what's loaded restarts the stream there
  if (S.pb?.hls) {
    const local = t - S.offset, v = S.v;
    const inBuffer = [...Array(v.buffered.length).keys()].some((i) => local >= v.buffered.start(i) - 1 && local <= v.buffered.end(i) + 30);
    if (local >= 0 && inBuffer) v.currentTime = local; else load(t);
  } else S.v.currentTime = t;
  tick();
}
const seekBy = (s) => { seekTo(pos() + s); flash(`${s > 0 ? '+' : ''}${s}s`); };
function setupSeek() {
  const bar = $('.pl-seek', root());
  let hover = null, dragging = false;
  const at = (e) => { const r = $('.track', bar).getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); });
  bar.addEventListener('pointerup', (e) => { if (dragging) { dragging = false; seekTo(at(e) * duration()); } });
  bar.addEventListener('pointermove', (e) => {
    const f = at(e), t = f * duration();
    if (!hover) { hover = document.createElement('div'); hover.className = 'pl-hover'; bar.append(hover); }
    hover.style.left = `${f * 100}%`;
    hover.innerHTML = `${thumb(t)}<span>${fmtTime(t)}${chapterAt(t) ? ` · ${esc(chapterAt(t))}` : ''}</span>`;
    if (dragging) { $('.done', bar).style.width = `${f * 100}%`; $('.knob', bar).style.left = `${f * 100}%`; }
  });
  bar.addEventListener('pointerleave', () => { hover?.remove(); hover = null; });
}
const chapterAt = (t) => { const cs = S.item.Chapters || []; let name = ''; for (const c of cs) if (c.StartPositionTicks / 1e7 <= t) name = c.Name; return /^chapter \d+$/i.test(name) ? '' : name; };
// Trickplay thumbnails (Jellyfin 10.9+)
function thumb(t) {
  const tp = S.item.Trickplay?.[S.pb?.source.Id];
  if (!tp) return '';
  const w = Object.keys(tp).map(Number).sort((a, b) => a - b).find((x) => x >= 200) || Number(Object.keys(tp)[0]);
  const info = tp[w]; if (!info) return '';
  const n = Math.floor((t * 1000) / info.Interval), per = info.TileWidth * info.TileHeight;
  const sheet = Math.floor(n / per), i = n % per, x = (i % info.TileWidth) * info.Width, y = Math.floor(i / info.TileWidth) * info.Height;
  const scale = 180 / info.Width;
  return `<div class="thumb" style="background-image:url('${jf.trickplayUrl(S.item.Id, w, sheet, S.pb.source.Id)}');background-position:-${x * scale}px -${y * scale}px;background-size:${info.Width * info.TileWidth * scale}px auto"></div>`;
}
async function loadSegments(it) {
  const list = (await jf.segments(it.Id)).map((s) => ({ type: s.Type, start: s.StartTicks / 1e7, end: s.EndTicks / 1e7 }));
  if (!list.length) { const i = await jf.intro(it.Id); if (i?.Valid) list.push({ type: 'Intro', start: i.IntroStart, end: i.IntroEnd }); }
  if (S?.item.Id === it.Id) { S.segments = list; paintButtons(); }
}

// Controls
function toggle() { if (!S) return; if (S.v.paused) S.v.play().catch(fail); else S.v.pause(); wake(); }
async function fullscreen(on) {
  if (desktop) { const r = await desktop.win('fullscreen', on); document.body.classList.toggle('fullscreen', r.fullscreen); return; }
  if (document.fullscreenElement) document.exitFullscreen(); else root().requestFullscreen?.();
}
async function pip() {
  if (S?.native) return mini();
  const v = S.v;
  try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); }
  catch { toast("Picture in picture isn't available here."); }
}
export async function mini(on) {
  if (!desktop || !S) return;
  const r = await desktop.win('mini', on);
  document.body.classList.toggle('mini', r.mini);
  $('[data-p=mini]', root())?.classList.toggle('on', r.mini);
}
function report(paused) { if (!S?.pb) return; groups.use(S.g); S.reported = Date.now(); jf.reportProgress(S.item, S.pb, pos(), paused ?? S.v.paused); }
function discord() {
  if (!desktop || !S || !settings.app.discord) return;
  const it = S.item, ep = it.Type === 'Episode';
  if (S.v.paused) return desktop.discord({ details: ep ? it.SeriesName : it.Name, state: 'Paused', text: 'Zenith' });
  desktop.discord({ details: ep ? it.SeriesName : it.Name, state: ep ? `S${it.ParentIndexNumber} E${it.IndexNumber} · ${it.Name}` : String(it.ProductionYear || ''), start: Date.now() - pos() * 1000, end: Date.now() + (duration() - pos()) * 1000, text: 'Watching on Zenith' });
}
function ended() {
  report(true);
  if (S.queue[0] && settings.playback.autoplayNext) nextEpisode();
  else close();
}
function showNext(next) {
  root().insertAdjacentHTML('beforeend', `<div data-air-video-controls class="pl-next"><img src="${esc(jf.img(next, 'Thumb', 320))}" alt=""><div><small>Up next</small><b>${esc(next.Name)}</b><small>S${next.ParentIndexNumber} E${next.IndexNumber}</small><div class="acts" style="margin-top:8px"><button class="btn gold small" data-p="next">Play now</button><button class="btn small" data-p="hidenext">Hide</button></div></div></div>`);
}
async function nextEpisode() {
  const n = S?.queue[0]; if (!n) return;
  const rest = S.queue.slice(1), list = S.list;
  const wasMini = document.body.classList.contains('mini');
  await play(n, { start: 0, queue: rest });
  if (list) S.list = list;
  if (wasMini) document.body.classList.add('mini');
}
async function prevEpisode() {
  const list = S?.list || (S ? await jf.allEpisodes(S.item.SeriesId).catch(() => []) : []);
  const i = list.findIndex((e) => e.Id === S.item.Id);
  if (i > 0) { await play(list[i - 1], { start: 0, queue: list.slice(i) }); S.list = list; }
}

// Menus: subtitles, settings (audio, quality, speed, size), episodes
function menu(kind) {
  const el = root();
  const old = $('.pl-menu', el);
  old?.remove();
  if (S.menu === kind) { S.menu = null; paintPlay(); return; }
  S.menu = kind;
  paintPlay();
  const pb = S.pb;
  let html = '';
  if (kind === 'subs') {
    html = `<h4>Subtitles</h4><button data-sub="off" class="${S.sub == null ? 'on' : ''}">Off</button>` +
      pb.subtitles.map((s) => `<button data-sub="${s.index}" ${s.textBased || (S.native && !s.external) ? '' : 'disabled'} class="${S.sub === s.index ? 'on' : ''}">${esc(s.label)}${s.forced ? ' (forced)' : ''}${s.textBased || (S.native && !s.external) ? '' : ' · unavailable in direct play'}</button>`).join('') +
      `<h4>Size</h4><div class="row2"><input type="range" min="60" max="200" step="10" value="${settings.playback.subtitleSize}" data-subsize><span>${settings.playback.subtitleSize}%</span></div>`;
  } else if (kind === 'settings') {
    html = `<h4>Audio</h4>${pb.audio.map((a) => `<button data-audio="${a.index}" class="${S.audio === a.index ? 'on' : ''}">${esc(a.label)}</button>`).join('') || '<button disabled>Only one track</button>'}
      <h4>Quality</h4>${QUALITIES.map(([b, l]) => `<button data-q="${b}" class="${(S.quality || 0) === b ? 'on' : ''}">${l}</button>`).join('')}
      <h4>Speed</h4>${SPEEDS.map((r) => `<button data-rate="${r}" class="${S.v.playbackRate === r ? 'on' : ''}">${r === 1 ? 'Normal' : r + 'x'}</button>`).join('')}
      <h4>Picture</h4><button data-p="fill" class="${el.classList.contains('fill') ? 'on' : ''}">Fill the screen</button><button data-p="info">Playback info</button>`;
  } else if (kind === 'episodes') {
    const list = S.list || [];
    html = `<h4>${esc(S.item.SeasonName || 'Episodes')}</h4>` + list.map((e) => `<button data-ep="${e.Id}" class="${e.Id === S.item.Id ? 'on' : ''}">S${e.ParentIndexNumber}E${e.IndexNumber} · ${esc(e.Name)}</button>`).join('');
  }
  el.insertAdjacentHTML('beforeend', `<div data-air-video-controls class="pl-menu">${html}</div>`);
  const m = $('.pl-menu', el);
  m.querySelector('.on')?.scrollIntoView({ block: 'center' });
  const size = $('[data-subsize]', m);
  if (size) size.oninput = () => { settings.playback.subtitleSize = Number(size.value); save(); applySubStyle(root()); size.nextElementSibling.textContent = size.value + '%'; };
}
async function onClick(e) {
  if (!S) return;
  const b = e.target.closest('button');
  if (!b) {
    if (!document.body.classList.contains('mini') && !e.target.closest('.pl-top,.pl-bottom,.pl-menu,.pl-next,.pl-skip,.pl-error,input,a')) toggle();
    return;
  }
  e.stopPropagation();
  const p = b.dataset.p;
  if (p === 'close') return close();
  if (p === 'toggle') return toggle();
  if (p === 'back10') return seekBy(-10);
  if (p === 'fwd30') return seekBy(30);
  if (p === 'mute') { setAudioMuted(S.v, !audioMuted(S.v)); paintVolume(); return; }
  if (p === 'next') return nextEpisode();
  if (p === 'prev') return prevEpisode();
  if (p === 'hidenext') return b.closest('.pl-next').remove();
  if (p === 'skipseg') { const seg = S.segments.find((s) => pos() >= s.start && pos() < s.end); if (seg) seekTo(seg.end); b.remove(); return; }
  if (p === 'fullscreen') return fullscreen();
  if (p === 'pip') return pip();
  if (p === 'mini') return mini();
  if (p === 'fill') { root().classList.toggle('fill'); b.classList.toggle('on'); return; }
  if (p === 'info') { const old = $('.pl-info', root()); if (old) return old.remove(); const pb = S.pb, vs = pb.video || {}; root().insertAdjacentHTML('beforeend', `<div data-air-video-controls class="pl-info">${esc(pb.method)}<br>${esc(pb.source.Container || '')} · ${esc(vs.Codec || '')} ${vs.Width || ''}x${vs.Height || ''}<br>${pb.source.Bitrate ? Math.round(pb.source.Bitrate / 1e5) / 10 + ' Mbps' : ''}<br>${esc(pb.audio.find((a) => a.index === S.audio)?.label || '')}</div>`); return; }
  if (['subs', 'settings', 'episodes'].includes(p)) return menu(p);
  if (b.dataset.sub != null) {
    const idx = b.dataset.sub === 'off' ? null : Number(b.dataset.sub);
    const s = S.pb.subtitles.find((x) => x.index === idx);
    S.sub = idx; S.menu = null; $('.pl-menu', root())?.remove();
    if (S.native) { applySubtitles(); paintButtons(); return; }
    if (s && !s.textBased) { S.subTextOk = false; return load(pos()); } // picture subtitles: the server draws them in
    if (S.pb.hls && S.subTextOk === false) { S.subTextOk = true; return load(pos()); }
    applySubtitles(); paintButtons(); return;
  }
  if (b.dataset.audio != null) {
    S.audio = Number(b.dataset.audio); S.menu = null; $('.pl-menu', root())?.remove();
    if (S.native) { await pickNativeAudio(); paintButtons(); return; }
    // Original file and the player can switch tracks itself: instant, no server work
    if (!S.pb.hls && canSwitchAudio && S.v.audioTracks?.length > 1) { pickFileAudio(); paintButtons(); return; }
    return load(pos());
  }
  if (b.dataset.q != null) { S.quality = 0; S.forceTranscode = false; S.menu = null; $('.pl-menu', root())?.remove(); toast(S.quality ? 'Changing quality...' : 'Back to the original file'); return load(pos()); }
  if (b.dataset.rate) { S.v.playbackRate = Number(b.dataset.rate); settings.playback.rate = S.v.playbackRate; save(); S.menu = null; $('.pl-menu', root())?.remove(); flash(`${S.v.playbackRate}x`); paintPlay(); return; }
  if (b.dataset.ep) { const list = S.list; const i = list.findIndex((x) => x.Id === b.dataset.ep); await play(list[i], { start: 0, queue: list.slice(i + 1) }); S.list = list; }
}
async function fail(e) {
  spin(false);
  const session = S, epoch = S?.loadEpoch;
  if (!session) return;
  const native = desktop?.info ? await desktop.info().catch(() => null) : null;
  if (S !== session || S.loadEpoch !== epoch) return;
  const source = S.pb?.source || S.item.MediaSources?.[0];
  const details = playbackFailure(e, native?.platform, source);
  // Keep failures local and actionable without requesting server conversion.
  const el = root();
  $('.pl-error', el)?.remove();
  const resume = $('.pl-resume', el); if (resume) resume.hidden = true;
  el.insertAdjacentHTML('beforeend', `<div data-air-video-controls class="pl-error"><div><h3>Playback problem</h3><p>${esc(details.message)}</p><div class="acts" style="justify-content:center"><button class="btn gold" data-p="retry">Try again</button><button class="btn" data-p="close">Close</button></div></div></div>`);
  $('[data-p=retry]', el).onclick = () => { $('.pl-error', el).remove(); load(pos()); };

}

export async function close(quiet) {
  if (!S) return;
  groups.use(S.g);
  const s = S; S = null;
  s.nativeAbort?.abort();
  try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); } catch {}
  if (document.body.classList.contains('mini')) { await desktop?.win('mini', false); document.body.classList.remove('mini'); }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (document.body.classList.contains('fullscreen')) { await desktop?.win('fullscreen', false); document.body.classList.remove('fullscreen'); }
  const p = s.offset + (s.v.currentTime || 0);
  if (s.pb) { jf.reportStop(s.item, s.pb, p); if (s.pb.hls) jf.stopTranscode(s.pb); }
  s.audioOut?.stop();
  await s.native?.destroy();
  s.hls?.destroy();
  s.v.removeAttribute('src'); s.v.load();
  root().hidden = true; root().innerHTML = '';
  document.body.classList.remove('playing');
  desktop?.discord(null);
  if (!quiet) emit('player', { open: false, item: s.item });
}

// Keyboard
document.addEventListener('keydown', (e) => {
  if (!S || /input|select|textarea/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  const map = {
    ' ': toggle, k: toggle, arrowleft: () => seekBy(e.shiftKey ? -30 : -10), arrowright: () => seekBy(e.shiftKey ? 60 : 30), j: () => seekBy(-10), l: () => seekBy(10),
    arrowup: () => { S.v.volume = Math.min(1, S.v.volume + 0.05); flash(`${Math.round(S.v.volume * 100)}%`); }, arrowdown: () => { S.v.volume = Math.max(0, S.v.volume - 0.05); flash(`${Math.round(S.v.volume * 100)}%`); },
    f: () => fullscreen(), m: () => (desktop ? mini() : (setAudioMuted(S.v, !audioMuted(S.v)))), p: pip, c: () => menu('subs'), n: nextEpisode, escape: () => (S.menu ? menu(S.menu) : document.body.classList.contains('mini') ? mini(false) : document.body.classList.contains('fullscreen') ? fullscreen(false) : close()),
    '>': () => { const i = SPEEDS.indexOf(S.v.playbackRate); S.v.playbackRate = SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]; flash(`${S.v.playbackRate}x`); }, '<': () => { const i = SPEEDS.indexOf(S.v.playbackRate); S.v.playbackRate = SPEEDS[Math.max(0, i - 1)]; flash(`${S.v.playbackRate}x`); },
  };
  if (/^[0-9]$/.test(k)) { seekTo((Number(k) / 10) * duration()); e.preventDefault(); return; }
  const fn = map[k]; if (fn) { e.preventDefault(); fn(); wake(); }
});
desktop?.on((ch, data) => {
  if (ch === 'media-key' && S) ({ toggle, next: nextEpisode, previous: prevEpisode, stop: close })[data]?.();
  if (ch === 'window' && 'mini' in data) document.body.classList.toggle('mini', data.mini);
  if (ch === 'window' && 'fullscreen' in data) document.body.classList.toggle('fullscreen', data.fullscreen);
});
window.addEventListener('beforeunload', () => { if (S?.pb) jf.reportStop(S.item, S.pb, pos()); });
