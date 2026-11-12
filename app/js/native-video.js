// The native surface keeps the original stream out of WebKit's text-sink pipeline.
// Session cancellation is checked on both sides of async native allocation.
export async function openNativeVideo(video, {url, controls, signal}, attach) {
  signal?.throwIfAborted();
  const factory = attach || (await import('../vendor/native-video.js')).attachTauriBackend;
  signal?.throwIfAborted();
  const controller = await factory(video, {
    source: {uri: url}, autoplay: true, signal, controlRegions: controls,
    playback: {engine: 'gstreamer', linux: {buffer: {maxSeconds: 15, maxBytes: 64 * 1024 * 1024}}},
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
