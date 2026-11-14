// Each asynchronous allocation keeps its own id, including after cancellation.
// A late response or close event must never close the replacement player.
export function createQtHandoff(desktop, {onClosed} = {}) {
  let active = null, disposed = false;
  const early = new Map();
  const cancelError = () => new DOMException('Playback cancelled','AbortError');
  const off = desktop.on((channel,data) => {
    if (channel !== 'qt-player-closed' || !data?.id) return;
    if (active?.id === data.id) {
      const owner = active; active = null; owner.removeAbort?.();
      onClosed?.(data);
    } else if (active && active.id == null) {
      early.set(data.id,data);
      if (early.size > 16) early.delete(early.keys().next().value);
    }
  });
  const cancel = async owner => {
    if (!owner) return;
    owner.cancelled = true; owner.removeAbort?.();
    if (active === owner) active = null;
    if (owner.id != null && !owner.closePromise) owner.closePromise = desktop.qtClose(owner.id);
    await owner.closePromise;
  };
  return {
    isOpen: () => !!active,
    async play(payload,{signal} = {}) {
      signal?.throwIfAborted();
      if (disposed) throw cancelError();
      // Merged cards keep a _copies graph containing the original item itself.
      // It belongs to the browsing view, not the player process. Preserve the
      // original cache and server ownership while sending plain media data.
      const transferable = JSON.parse(JSON.stringify(payload,(key,value) => key === '_copies' ? undefined : value));
      const previous = active;
      const owner = {id:null,cancelled:false}; active = owner;
      const aborted = () => { cancel(owner).catch(() => {}); };
      signal?.addEventListener('abort',aborted,{once:true});
      owner.removeAbort = () => signal?.removeEventListener('abort',aborted);
      try {
        // Mark pending allocations cancelled before waiting on a native close.
        if (previous) await cancel(previous);
        signal?.throwIfAborted();
        if (active !== owner || owner.cancelled) throw cancelError();
        const result = await desktop.qtPlay(transferable);
        owner.id = result.id;
        if (owner.id == null) throw new Error('Playback helper did not start.');
        if (owner.cancelled || signal?.aborted || active !== owner || disposed) {
          await cancel(owner); throw signal?.reason || cancelError();
        }
        const closed = early.get(owner.id); early.delete(owner.id);
        if (closed) {
          active = null; owner.removeAbort(); onClosed?.(closed);
          throw new Error(closed.error || 'Playback helper closed.');
        }
        return result;
      } catch (error) {
        owner.removeAbort?.();
        if (active === owner) active = null;
        throw error;
      }
    },
    close: () => cancel(active),
    async destroy() { disposed = true; off(); early.clear(); await cancel(active); },
  };
}
