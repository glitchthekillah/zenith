// Same-origin Kavita login bridge. Inactive during ordinary Kavita browsing.
(() => {
  'use strict';
  const origin = 'https://zenith.glitchthekillah.com', key = 'zenith-login-handoff';
  const nonce = new URLSearchParams(location.search).get('zenith-connect');
  if (/^[a-f0-9]{32}$/.test(nonce || '') && window.opener)
    sessionStorage.setItem(key, JSON.stringify({ nonce, expires: Date.now() + 10 * 60e3 }));
  let marker;
  try { marker = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return; }
  if (!marker || !/^[a-f0-9]{32}$/.test(marker.nonce || '') || marker.expires < Date.now() || !window.opener) return;
  let busy = false, sent = false, timer;
  const notify = data => window.opener.postMessage({ type: 'zenith-kavita-login', nonce: marker.nonce, ...data }, origin);
  window.addEventListener('message', e => {
    if (e.origin !== origin || e.source !== window.opener || e.data?.type !== 'zenith-kavita-accepted' || e.data.nonce !== marker.nonce) return;
    clearInterval(timer); sessionStorage.removeItem(key); window.close();
  });
  async function check() {
    if (busy || sent) return;
    if (Date.now() > marker.expires) { clearInterval(timer); sessionStorage.removeItem(key); return; }
    busy = true;
    try {
      const r = await fetch('/api/Account', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) return;
      const user = await r.json();
      if (!user?.username) return;
      const apiKey = user.authKeys?.find(k => k.name === 'opds')?.key || user.apiKey;
      if (!apiKey) { sent = true; notify({ error: 'Kavita did not provide an API key for this account.' }); return; }
      const exchange = await fetch('/api/Plugin/authenticate?apiKey=' + encodeURIComponent(apiKey) + '&pluginName=Zenith', { method: 'POST', credentials: 'include' });
      if (!exchange.ok) { sent = true; notify({ error: 'Kavita could not authorize this app (' + exchange.status + ').' }); return; }
      const login = await exchange.json();
      if (typeof login.token !== 'string' || !login.token) { sent = true; notify({ error: 'Kavita did not return an app sign-in token.' }); return; }
      sent = true;
      notify({ login: { token: login.token, refreshToken: login.refreshToken || '', apiKey: user.authKeys?.find(k => k.name === 'image-only')?.key || login.apiKey || apiKey, username: user.username } });
    } catch {} finally { busy = false; }
  }
  timer = setInterval(check, 1000);
  check();
})();
