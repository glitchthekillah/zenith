// Count servers with unfinished work, rather than counting parallel requests.
export function createServerLoading(publish) {
  const pending = new Map();
  let previous = '';
  const current = () => ({count: pending.size, names: [...pending.values()].map(x => x.name)});
  const notify = () => {
    const state = current(), key = JSON.stringify(state);
    if (key !== previous) { previous = key; publish(state); }
  };
  return {
    current,
    begin(server) {
      if (!server) return () => {};
      const entry = pending.get(server.id) || {name: server.name, requests: 0};
      entry.requests++; pending.set(server.id, entry); notify();
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        if (--entry.requests === 0) pending.delete(server.id);
        notify();
      };
    },
  };
}
