// Server-side HTTP for the app: used by the desktop app (electron/main.js) and the
// web server (server/serve.js). The page asks for a request, this makes it, so the
// servers don't need to allow cross-site requests. Cookies (Seerr and the ask site
// sign in with a cookie) are kept per session and per server, never shown to the page.
'use strict';

const jars = new Map(); // session -> Map(origin -> Map(name -> value))
const MAX_BODY = 30 * 1024 * 1024;

function jarFor(session, origin) {
  if (!jars.has(session)) jars.set(session, new Map());
  const s = jars.get(session);
  if (!s.has(origin)) s.set(origin, new Map());
  return s.get(origin);
}

function keepCookies(jar, headers) {
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const line of list) {
    const [pair, ...attrs] = line.split(';');
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\b/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split('=')[1]) < Date.now()));
    if (expired || !value) jar.delete(name); else jar.set(name, value);
  }
}

// opts: { method, headers, body (string), session, timeout }
// returns { ok, status, headers, body, base64 } (base64 true when body is binary)
async function request(url, opts = {}) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https addresses work.');
  const jar = jarFor(opts.session || 'default', u.origin);
  const headers = { ...(opts.headers || {}) };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  try {
    const res = await fetch(u, { method: opts.method || 'GET', headers, body: opts.body ?? undefined, redirect: 'follow', signal: ctrl.signal });
    const before = jar.size + [...jar.values()].join('|');
    keepCookies(jar, res.headers);
    if (onChange && before !== jar.size + [...jar.values()].join('|')) onChange();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY) throw new Error('That response is too large.');
    const type = res.headers.get('content-type') || '';
    const text = /json|text|xml|javascript|html/.test(type) || !type;
    return {
      ok: res.ok, status: res.status,
      headers: { 'content-type': type, location: res.headers.get('location') || '' },
      body: text ? buf.toString('utf8') : buf.toString('base64'), base64: !text,
    };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server took too long to answer.');
    throw new Error(e.cause?.code === 'ENOTFOUND' ? "Couldn't find that server. Check the address." : e.cause?.code === 'ECONNREFUSED' ? 'The server refused the connection. Is it running?' : e.cause?.code?.startsWith?.('CERT') || /certificate/i.test(e.cause?.message || '') ? "The server's HTTPS certificate isn't valid." : e.message || 'Network error.');
  } finally { clearTimeout(timer); }
}

function forget(session, origin) {
  if (!jars.has(session)) return;
  if (origin) jars.get(session).delete(origin); else jars.delete(session);
  onChange?.();
}

// Save and restore sign-in cookies (the desktop app keeps them between launches)
let onChange = null;
function dump() { const out = {}; for (const [s, m] of jars) { out[s] = {}; for (const [o, j] of m) out[s][o] = Object.fromEntries(j); } return out; }
function load(data) { for (const [s, m] of Object.entries(data || {})) for (const [o, j] of Object.entries(m)) { const jar = jarFor(s, o); for (const [k, v] of Object.entries(j)) jar.set(k, v); } }
function watch(fn) { onChange = fn; }
function importCookies(session, origin, cookies) {
  const jar = jarFor(session, origin);
  for (const cookie of cookies) jar.set(cookie.name, cookie.value);
  onChange?.();
}
module.exports = { request, forget, dump, load, watch, importCookies };
