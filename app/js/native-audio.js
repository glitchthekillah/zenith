// Render decoded audio in the Windows app process, with one owner per video.
const outputs = new WeakMap();
let openQueue = Promise.resolve();
export const audioMuted = (video) => outputs.get(video)?.muted ?? video.muted;
export function setAudioMuted(video, muted) {
  const state = outputs.get(video);
  if (state) { state.muted = !!muted; state.refresh(); }
  video.muted = state?.active ? true : !!muted;
}
export function attachNativeAudio(video, desktop, enabled) {
  if (!enabled || !desktop?.audioOpen || !video.captureStream) return {stop() {}, flush() {}};
  let stopped = false, opening = false, attempted = false, context, source, gain, node, captured, id = null, pending = 0, flushed = Promise.resolve();
  const state = {muted: audioMuted(video), active: false, generation: 0, refresh() {
    if (gain) gain.gain.value = state.muted ? 0 : video.volume;
  }};
  outputs.set(video, state);
  const ownsVideo = () => outputs.get(video) === state;
  const release = () => {
    state.active = false;
    if (node) { node.port.onmessage = null; node.port.close?.(); node.disconnect(); }
    source?.disconnect(); gain?.disconnect();
    for (const track of captured?.getTracks?.() || []) track.stop();
    context?.close().catch(() => {});
    if (id != null) desktop.audioClose(id).catch(() => {});
    id = null;
    // An old async startup/failure must never restore sound over a newer owner.
    if (ownsVideo()) { outputs.delete(video); video.muted = state.muted; }
  };
  const reset = () => {
    const generation = ++state.generation;
    node?.port.postMessage?.({generation});
    if (id != null) {
      const output = id;
      flushed = desktop.audioFlush(output, generation).catch(() => { if (id === output && state.generation === generation) release(); });
    }
  };
  const start = async () => {
    if (stopped || !ownsVideo() || attempted || opening) return;
    opening = true;
    try {
      if ((await desktop.info()).platform !== 'win32' || stopped || !ownsVideo()) return;
      const stream = captured = video.captureStream();
      if (!stream.getAudioTracks().length) return;
      attempted = true;
      context = new AudioContext({latencyHint: 'interactive'});
      await context.audioWorklet.addModule(new URL('./native-audio-worklet.js', import.meta.url));
      await context.resume();
      if (stopped || !ownsVideo() || context.state !== 'running') throw new Error('Audio context unavailable');
      // Serialize native opens even if a previous controller is still starting.
      id = await (openQueue = openQueue.catch(() => {}).then(() => {
        if (stopped || !ownsVideo()) throw new Error('Audio startup superseded');
        return desktop.audioOpen(context.sampleRate);
      }));
      if (stopped || !ownsVideo() || !id) throw new Error('Native audio output unavailable');
      await desktop.audioFlush(id, state.generation);
      if (stopped || !ownsVideo()) throw new Error('Audio startup superseded');
      source = context.createMediaStreamSource(stream); gain = context.createGain();
      gain.channelCount = 2; gain.channelCountMode = 'explicit'; gain.channelInterpretation = 'speakers';
      node = new AudioWorkletNode(context, 'zenith-native-audio', {channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2]});
      node.port.postMessage?.({generation: state.generation}); state.refresh();
      node.port.onmessage = async ({data}) => {
        if (stopped || !ownsVideo() || !id || video.paused || video.seeking || data.generation !== state.generation) return;
        if (++pending > 4) { pending--; release(); return; }
        const output = id, generation = data.generation;
        try {
          await flushed;
          if (stopped || id !== output || generation !== state.generation) return;
          const accepted = await desktop.audioWrite(output, generation, Array.from(data.samples));
          if (stopped || !ownsVideo() || id !== output || generation !== state.generation) return;
          if (!accepted) { release(); return; }
          state.active = true;
          if (!video.muted) video.muted = true;
        } catch { if (!stopped && ownsVideo() && generation === state.generation) release(); }
        finally { pending--; }
      };
      source.connect(gain); gain.connect(node); node.connect(context.destination);
      context.onstatechange = () => { if (!stopped && state.active && context.state !== 'running') release(); };
    } catch { release(); }
    finally { opening = false; }
  };
  const playing = () => { if (attempted) reset(); return start(); };
  const events = {playing, pause: reset, seeking: reset, emptied: reset, volumechange: state.refresh};
  for (const [event, handler] of Object.entries(events)) video.addEventListener(event, handler);
  return {stop() {
    if (stopped) return;
    stopped = true; release();
    for (const [event, handler] of Object.entries(events)) video.removeEventListener(event, handler);
  }, flush: reset};
}
