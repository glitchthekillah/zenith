// This module deliberately has no static imports of core/player: they capture
// desktop capabilities and saved server state at module evaluation time.
export function createQtBridge(bridge) {
  const pending = new Map(), listeners = new Set();
  let sequence = 0;
  bridge.completed.connect((id,result) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id); clearTimeout(request.timer);
    if (result?.ok) request.resolve(result.data);
    else request.reject(new Error('Playback helper request failed.'));
  });
  bridge.event.connect((channel,data) => {
    for (const fn of listeners) { try { fn(channel,data); } catch {} }
  });
  return {
    backend:'qt-mpv',
    call(action,args = {}) {
      const id = String(++sequence);
      return new Promise((resolve,reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Playback helper request timed out.')); },60000);
        pending.set(id,{resolve,reject,timer});
        try { bridge.request(id,action,args); }
        catch { pending.delete(id); clearTimeout(timer); reject(new Error('Playback helper request failed.')); }
      });
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
export function seedQtBootstrap(payload,storage) {
  if (!payload?.group?.id || !payload?.item || !payload?.deviceId) throw new Error('Invalid playback bootstrap.');
  const settings = {...payload.settings,groups:[payload.group]};
  delete settings.servers;
  storage.setItem('zenith',JSON.stringify(settings));
  storage.setItem('zenith-device',String(payload.deviceId));
}
export function bindQtWindowDrag(document,qt) {
  let press = null;
  document.addEventListener('mousedown',event => {
    const target = event.target;
    const canDrag = document.body.classList.contains('mini') && target?.closest?.('#player')
      && !target.closest('button,a,input,select,textarea,[role=slider],.pl-bottom,.pl-menu,.pl-next,.pl-error,.pl-info');
    press = event.button === 0 && event.detail < 2 && canDrag ? {x:event.screenX,y:event.screenY} : null;
  });
  document.addEventListener('mousemove',event => {
    if (!press) return;
    if (!(event.buttons & 1)) { press = null; return; }
    if (Math.abs(event.screenX - press.x) + Math.abs(event.screenY - press.y) < 4) return;
    press = null;
    qt.call('win',{action:'drag'}).catch(() => {});
  });
  document.addEventListener('mouseup',() => { press = null; });
}
export async function startQtPlayer(scope = window, importModule = path => import(path)) {
  if (!scope.qt?.webChannelTransport || !scope.QWebChannel) throw new Error('Playback bridge unavailable.');
  const channel = await new Promise(resolve => new scope.QWebChannel(scope.qt.webChannelTransport,resolve));
  const qt = scope.zenithQt = createQtBridge(channel.objects.bridge);
  scope.zenithDesktop = {
    qtPlayer:true,nativeVideo:true,
    http:(url,opts) => qt.call('http',{url,opts:opts || {}}),
    win:(action,arg) => qt.call('win',{action,...(arg == null ? {} : {arg})}),
    discord:activity => qt.call('discord',{activity:activity || null}),
    notify:(title,body) => qt.call('notify',{title:String(title),body:body == null ? null : String(body)}),
    info:async () => ({platform:'linux',backend:'qt-mpv'}),
    focused:() => scope.document.hasFocus(),
    on:fn => qt.on((channel,data) => {
      if (channel !== 'media-key') return fn(channel,data);
      const key = typeof data === 'object' ? (data.key ?? data.data) : data;
      const normalized = String(key).replace(/^Media/,'').toLowerCase();
      fn(channel,({playpause:'toggle',play:'play',pause:'pause',next:'next',previous:'previous',stop:'stop',toggle:'toggle'})[normalized]);
    }),
  };
  bindQtWindowDrag(scope.document,qt);
  qt.on((channel,data) => {
    if (channel !== 'media-key') return;
    const key = String(typeof data === 'object' ? (data.key ?? data.data) : data).replace(/^Media/,'').toLowerCase();
    if (key === 'play' || key === 'pause') qt.call('media.' + key).catch(() => {});
  });
  const payload = await qt.call('bootstrap');
  seedQtBootstrap(payload,scope.localStorage);
  qt.qtVersion = payload.qtVersion;
  qt.diagnostics = {backend:payload.backend || 'qt-mpv',qtVersion:payload.qtVersion};
  const core = await importModule('./core.js');
  core.groups.use(payload.group.id);
  const player = await importModule('./player.js');
  const exit = () => qt.call('exit',{playback:core.settings.playback}).catch(() => {});
  core.on('player',data => { if (!data.open) exit(); });
  let closing = false;
  qt.on(async channel => {
    if (channel !== 'close-request' || closing) return;
    closing = true;
    try { await player.close(false); } finally { exit(); }
  });
  await player.play(payload.item,{...payload.options,selection:payload.selection});
}
if (typeof window !== 'undefined' && window.document?.documentElement?.dataset.qtPlayer !== undefined) {
  startQtPlayer().catch(() => {
    const status = document.getElementById('qt-status');
    if (status) { status.hidden = false; status.textContent = 'The playback window could not start. Close this window and try again.'; }
  });
}
