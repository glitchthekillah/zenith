// "Watching ..." / "Reading ..." on the user's Discord profile, using Discord's local
// RPC socket (no extra packages). Needs an application ID from the Discord Developer
// Portal in package.json -> zenith.discordClientId. Without one this does nothing.
'use strict';
const net = require('net');
const path = require('path');
const os = require('os');

const CLIENT_ID = (require('../package.json').zenith || {}).discordClientId || '';
let sock = null, ready = false, wanted = null, retry = null, nonce = 0;

function pipePaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  const dirs = [base, path.join(base, 'app/com.discordapp.Discord'), path.join(base, 'snap.discord'), path.join(base, '.flatpak/com.discordapp.Discord/xdg-run'), os.tmpdir()];
  return dirs.flatMap((d) => Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)));
}
function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8); head.writeInt32LE(op, 0); head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}
function tryConnect(list, i = 0) {
  if (i >= list.length) return schedule();
  const s = net.createConnection(list[i]);
  s.once('error', () => { s.destroy(); tryConnect(list, i + 1); });
  s.once('connect', () => {
    sock = s;
    s.on('data', (buf) => { if (!ready && buf.length >= 8 && buf.readInt32LE(0) === 1) { ready = true; push(); } });
    s.on('close', () => { sock = null; ready = false; schedule(); });
    s.on('error', () => {});
    s.write(frame(0, { v: 1, client_id: CLIENT_ID }));
  });
}
function schedule() { clearTimeout(retry); retry = setTimeout(() => { if (!sock) tryConnect(pipePaths()); }, 30000); retry.unref?.(); }
function push() {
  if (!ready || !sock) return;
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: wanted || undefined }, nonce: String(++nonce) }));
}
// activity: { details, state, start (ms), end (ms), image, text } or null to clear
function set(a) {
  if (!CLIENT_ID) return false;
  wanted = a ? {
    type: a.type === 'reading' ? 0 : 3, // 3 = Watching
    details: String(a.details || '').slice(0, 120) || undefined,
    state: String(a.state || '').slice(0, 120) || undefined,
    timestamps: a.start ? { start: Math.floor(a.start), end: a.end ? Math.floor(a.end) : undefined } : undefined,
    assets: { large_image: a.image && /^https:\/\//.test(a.image) ? a.image : 'zenith', large_text: String(a.text || 'Zenith').slice(0, 120) },
    instance: false,
  } : null;
  push();
  return true;
}
function start() { if (CLIENT_ID) tryConnect(pipePaths()); }
function stop() { clearTimeout(retry); try { sock?.destroy(); } catch {} }
module.exports = { start, stop, set };
