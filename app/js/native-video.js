// The native surface keeps the original stream out of WebKit's text-sink pipeline.
// Session cancellation is checked on both sides of async native allocation.
export async function openNativeVideo(video, {url, controls, signal}, attach) {
  signal?.throwIfAborted();
  if (globalThis.zenithQt && !attach) {
    const {openQtNativeVideo} = await import('./qt-native-video.js');
    return openQtNativeVideo(video, {url, signal});
  }
  const factory = attach || (await import('../vendor/native-video.js')).attachTauriBackend;
  signal?.throwIfAborted();
  const controller = await factory(video, {
    source: {uri: url}, autoplay: true, signal, controlRegions: controls, suspendWhenHidden: false,
    playback: {engine: 'gstreamer', linux: {buffer: {maxSeconds: 3, maxBytes: 64 * 1024 * 1024}}},
  });
  if (signal?.aborted) {
    await controller.destroy();
    signal.throwIfAborted();
  }
  return controller;
}

// Jellyfin uses file-wide indices; the native track IDs belong to each media kind.
// External subtitles are loaded separately and do not occupy an in-file ordinal.
export function nativeTrackId(controller, kind, index, listed) {
  if (index == null) return undefined;
  const ordinal = listed.filter(t => !t.external).findIndex(t => t.index === index);
  return ordinal < 0 ? undefined : controller.tracks.filter(t => t.kind === kind)[ordinal]?.id;
}
export function waitNativeVideo(video, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const events = ['loadedmetadata', 'canplay', 'timeupdate'];
    const finish = (error) => {
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, check);
      signal?.removeEventListener('abort', cancelled);
      error ? reject(error) : resolve();
    };
    const cancelled = () => finish(signal.reason || new DOMException('Playback cancelled', 'AbortError'));
    const check = () => { if (video.videoWidth > 0 && video.readyState >= 2) finish(); };
    for (const event of events) video.addEventListener(event, check);
    signal?.addEventListener('abort', cancelled, {once:true});
    timer = setTimeout(() => finish(new Error('Original-file video did not become ready.')), 45000);
    if (signal?.aborted) cancelled(); else check();
  });
}
export function parseNativeCues(text) {
  const stamp = value => {
    const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
    if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return NaN;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  };
  const cues = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s.*)?$/.exec(lines[index]);
    if (!match) continue;
    const start = stamp(match[1]), end = stamp(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) cues.push({start,end,text:lines.slice(index+1).join('\n')});
  }
  return cues;
}
export function nativeCueText(cues, time) { return cues.filter(c => time >= c.start && time < c.end).map(c => c.text); }
