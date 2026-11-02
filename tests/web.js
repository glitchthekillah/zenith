// Tries the web version (server/serve.js) against tests/mock-servers.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8484/'); await p.waitForTimeout(800);
  await p.fill('#first-form [name=url]', 'http://localhost:8096'); await p.fill('#first-form [name=username]', 'nyx'); await p.fill('#first-form [name=password]', 'pw');
  await p.click('#first-form button'); await p.waitForTimeout(1000);
  await p.evaluate(() => { location.hash = '#/home'; }); await p.waitForTimeout(1500);
  await p.screenshot({ path: (process.env.SHOTS || '/tmp') + '/web-home.png' });
  await p.evaluate(() => { location.hash = '#/item/m3'; }); await p.waitForTimeout(800); await p.click('[data-play]'); await p.waitForTimeout(2500);
  console.log('video', await p.evaluate(() => { const v = document.querySelector('#player video'); return v && [v.currentTime > 0, v.videoWidth]; }), 'errs', errs.join(' | '));
  await b.close();
})();
