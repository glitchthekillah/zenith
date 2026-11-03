// Zenith in a web browser. Serves the same interface as the desktop app and passes
// its server requests along (browsers block direct cross-site requests).
//
//   ZENITH_HOSTS=https://jellyfin.example.com,https://seerr.example.com  PORT=8484  node server/serve.js
//
// ZENITH_HOSTS lists the only servers it will talk to, so this can't be used as an
// open proxy. Put it behind HTTPS (Caddy, nginx, Tailscale Serve) if it's public.
'use strict';
const httpServer = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('../shared/http');

const PORT = Number(process.env.PORT) || 8484;
const APP_DIR = path.join(__dirname, '..', 'app');
const HOSTS = String(process.env.ZENITH_HOSTS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean).map((s) => new URL(s).origin);
// Public info for books and manga (covers, banners, summaries) always allowed
HOSTS.push('https://graphql.anilist.co');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

if (!HOSTS.length) console.warn('ZENITH_HOSTS is empty: set it to your Jellyfin (and Kavita, Seerr, ask site) addresses, separated by commas.');

const readBody = (req, max = 2 * 1024 * 1024) => new Promise((ok, fail) => {
  let size = 0; const parts = [];
  req.on('data', (c) => { size += c.length; if (size > max) { fail(new Error('too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
  req.on('error', fail);
});
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };

httpServer.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (url.pathname === '/api/config') return json(res, 200, { web: true, hosts: HOSTS });
  if (url.pathname === '/api/http' && req.method === 'POST') {
    // Only from this page (same origin), only to the listed servers
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Not allowed.' });
    let job; try { job = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'Bad request.' }); }
    let target; try { target = new URL(job.url); } catch { return json(res, 400, { error: 'Bad address.' }); }
    if (!HOSTS.includes(target.origin)) return json(res, 403, { error: `This web version isn't set up for ${target.origin}. Add it to ZENITH_HOSTS.` });
    const session = /^[a-f0-9]{32}$/.test(req.headers['x-zenith-session'] || '') ? req.headers['x-zenith-session'] : crypto.randomBytes(16).toString('hex');
    try { return json(res, 200, await http.request(target.href, { method: job.method, headers: job.headers, body: job.body, session })); }
    catch (e) { return json(res, 502, { error: e.message }); }
  }
  // Static files
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(APP_DIR, p));
  if (!file.startsWith(APP_DIR)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { // unknown paths load the app (it has its own routes)
      return fs.readFile(path.join(APP_DIR, 'index.html'), (e2, html) => { res.writeHead(e2 ? 404 : 200, { 'Content-Type': TYPES['.html'] }); res.end(html); });
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': /\.(woff2|png|svg)$/.test(file) ? 'public, max-age=604800' : 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Zenith web is on http://localhost:${PORT}`));
