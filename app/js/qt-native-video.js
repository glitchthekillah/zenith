// HTMLMediaElement facade for the helper's MpvQt surface. Only decoded snapshots
// advance the clock: a requested seek must never become reported server progress.
const qtOwners = new WeakMap();
export async function openQtNativeVideo(video, {url, signal}, qt = window.zenithQt) {
  signal?.throwIfAborted();
  const uri = new URL(url);
  if (!/^https?:$/.test(uri.protocol)) throw new Error('Original-file playback requires HTTP or HTTPS.');
  const previous = qtOwners.get(video);
  if (previous) await previous.destroy();
  signal?.throwIfAborted();
  let generation, destroyed = false, attached = false, latest = null, pendingSeek = null;
  const queued = new Map(), originals = new Map(), listeners = new Set();
  const state = {currentTime:0,duration:NaN,videoWidth:0,videoHeight:0,paused:true,
    ended:false,seeking:false,readyState:0,networkState:2,error:null,
    volume:video.volume ?? 1,muted:!!video.muted,playbackRate:video.playbackRate || 1,tracks:[]};
  const dispatch = name => { if (attached && !destroyed) video.dispatchEvent(new Event(name)); };
  const fail = () => {
    if (destroyed) return;
    const error = new Error('Original-file playback failed.');
    state.error = {code:3,message:error.message};
    for (const fn of listeners) { try { fn({type:'error',detail:error}); } catch {} }
    dispatch('error');
  };
  const call = async (action, args = {}) => {
    if (destroyed) return;
    try { return await qt.call(action, {...args,generation}); }
    catch { fail(); throw new Error('Original-file playback failed.'); }
  };
  const fire = (action, args) => { call(action,args).catch(() => {}); };
  const snapshot = data => {
    if (destroyed || data.generation !== generation) return;
    const before = {...state}, wasBuffering = latest?.buffering;
    latest = data;
    for (const name of ['currentTime','duration','volume','muted','paused','ended']) {
      if (data[name] !== undefined) state[name] = data[name];
    }
    if (data.width !== undefined) state.videoWidth = data.width;
    if (data.height !== undefined) state.videoHeight = data.height;
    if (data.rate !== undefined) state.playbackRate = data.rate;
    if (Array.isArray(data.tracks)) state.tracks = data.tracks;
    state.readyState = state.videoWidth > 0 ? (data.buffering ? 2 : 4) : 0;
    state.networkState = data.buffering ? 2 : 1;
    if (state.error || data.error) { if (data.error && !state.error) fail(); return; }
    if (!before.videoWidth && state.videoWidth) dispatch('loadedmetadata');
    if (before.duration !== state.duration) dispatch('durationchange');
    if (data.buffering && !wasBuffering) dispatch('waiting');
    if (state.readyState >= 3 && before.readyState < 3) dispatch('canplay');
    if (before.paused && !state.paused) dispatch('play');
    if (!state.paused && !data.buffering && (before.paused || before.readyState < 3)) dispatch('playing');
    if (!before.paused && state.paused) dispatch('pause');
    if (before.volume !== state.volume || before.muted !== state.muted) dispatch('volumechange');
    if (before.playbackRate !== state.playbackRate) dispatch('ratechange');
    if (pendingSeek && (data.seeking === false ||
        (Number.isFinite(data.currentTime) && Math.abs(data.currentTime - pendingSeek.target) <= pendingSeek.tolerance))) {
      pendingSeek = null; state.seeking = false; dispatch('seeked');
    }
    if (data.currentTime !== undefined) dispatch('timeupdate');
    dispatch('progress');
    if (!before.ended && state.ended) dispatch('ended');
  };
  const off = qt.on((channel,data) => {
    if (channel !== 'media' || destroyed) return;
    if (generation === undefined) { queued.set(data.generation,data); if (queued.size > 8) queued.delete(queued.keys().next().value); }
    else snapshot(data);
  });
  let stopPromise;
  const stop = () => generation === undefined ? Promise.resolve() : (stopPromise ||= qt.call('media.stop',{generation}).catch(() => {}));
  const controller = {
    get tracks() { return state.tracks; },
    on(name,fn) { if (name === 'error') listeners.add(fn); return () => listeners.delete(fn); },
    async seek(position) {
      if (destroyed || !Number.isFinite(position)) return;
      const target = Math.max(0,position);
      pendingSeek = {target,tolerance:0.75};
      state.seeking = true; dispatch('seeking');
      await call('media.seek',{position:target});
    },
    setPlaybackRate: value => call('media.rate',{value}),
    selectTrack: (kind,id) => call('media.track',{kind,...(id == null ? {} : {id})}),
    async destroy() {
      if (!destroyed) {
        destroyed = true; off(); signal?.removeEventListener('abort',cancelled);
        pendingSeek = null;
        if (qtOwners.get(video) === controller) {
          qtOwners.delete(video);
          for (const [name,descriptor] of originals) {
            if (descriptor) Object.defineProperty(video,name,descriptor); else delete video[name];
          }
        }
        if (qt.controller === controller) qt.controller = null;
        listeners.clear();
      }
      await stop();
    },
  };
  const cancelled = () => { controller.destroy().catch(() => {}); };
  qtOwners.set(video,controller);
  signal?.addEventListener('abort',cancelled,{once:true});
  try {
    const result = await qt.call('media.open',{uri:url,volume:state.volume,muted:state.muted,rate:state.playbackRate});
    generation = result.generation;
    if (generation == null) throw new Error('Invalid media generation.');
    if (destroyed || signal?.aborted || qtOwners.get(video) !== controller) {
      await controller.destroy();
      throw signal?.reason || new DOMException('Playback cancelled','AbortError');
    }
    const override = (name,descriptor) => {
      originals.set(name,Object.getOwnPropertyDescriptor(video,name));
      Object.defineProperty(video,name,{configurable:true,...descriptor});
    };
    for (const name of ['currentTime','duration','videoWidth','videoHeight','paused','ended','seeking','readyState','networkState','error','volume','muted','playbackRate']) {
      const descriptor = {get:() => state[name]};
      if (name === 'currentTime') descriptor.set = value => { controller.seek(Number(value)).catch(() => {}); };
      if (name === 'playbackRate') descriptor.set = value => { state.playbackRate = Number(value); fire('media.rate',{value:state.playbackRate}); dispatch('ratechange'); };
      if (name === 'volume' || name === 'muted') descriptor.set = value => {
        state[name] = name === 'muted' ? !!value : Math.max(0,Math.min(1,Number(value)));
        fire('media.volume',{value:state.volume,muted:state.muted}); dispatch('volumechange');
      };
      override(name,descriptor);
    }
    const ranges = {length:0,start() { throw new DOMException('No buffered range','IndexSizeError'); },end() { throw new DOMException('No buffered range','IndexSizeError'); }};
    override('buffered',{get:() => ranges});
    override('play',{value:() => call('media.play')});
    override('pause',{value:() => fire('media.pause')});
    override('load',{value:() => {}});
    attached = true; qt.controller = controller;
    if (queued.has(generation)) snapshot(queued.get(generation));
    queued.clear();
    return controller;
  } catch (error) {
    await controller.destroy();
    if (signal?.aborted) signal.throwIfAborted();
    throw error;
  }
}
