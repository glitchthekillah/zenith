// Drives the desktop app against tests/mock-servers.js and saves screenshots.
const { _electron: electron } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || '/tmp';
(async () => {
  const app = await electron.launch({ executablePath: process.env.EXE || require('electron'), args: process.env.EXE ? ['--no-sandbox'] : [path.join(__dirname, '..'), '--no-sandbox'], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  const w = await app.firstWindow();
  const errs = [];
  w.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  w.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  await w.setViewportSize?.({ width: 1360, height: 860 }).catch(() => {});
  const shot = async (n) => { await w.waitForTimeout(900); await w.screenshot({ path: `${OUT}/z-${n}.png` }); console.log('shot', n, errs.splice(0).join(' || ').slice(0, 600)); };
  await w.waitForTimeout(1500); await shot('welcome');
  await w.fill('#first-form [name=url]', 'http://localhost:8096');
  await w.fill('#first-form [name=username]', 'glitch');
  await w.fill('#first-form [name=password]', 'pw');
  await w.click('#first-form button'); await w.waitForTimeout(800); await shot('after-first');
  // Kavita + ask
  for (const [k, url] of [['kavita', 'http://localhost:5000'], ['ask', 'http://localhost:3300']]) {
    await w.click(`[data-add=${k}]`); await w.fill(`[data-connect=${k}] [name=url]`, url); await w.fill(`[data-connect=${k}] [name=username]`, 'glitch'); await w.fill(`[data-connect=${k}] [name=password]`, 'pw'); await w.click(`[data-connect=${k}] button`); await w.waitForTimeout(900);
  }
  await shot('settings');
  await w.evaluate(() => { location.hash = '#/home'; }); await w.waitForTimeout(1500); await shot('home');
  await w.evaluate(() => { location.hash = '#/movies'; }); await shot('movies');
  await w.evaluate(() => { location.hash = '#/item/s1'; }); await shot('series');
  await w.evaluate(() => { location.hash = '#/item/m1'; }); await shot('movie');
  await w.click('[data-play]'); await w.waitForTimeout(3500); await w.mouse.move(600, 400); await shot('player');
  await w.click('[data-p=settings]'); await shot('player-menu');
  await w.click('[data-p=settings]');
  const st = await w.evaluate(() => { const v = document.querySelector('#player video'); return { t: v.currentTime, paused: v.paused, w: v.videoWidth, tracks: v.textTracks.length }; }); console.log('video', JSON.stringify(st));
  await w.click('[data-p=mini]'); await w.waitForTimeout(1200); await shot('mini');
  await w.keyboard.press('Escape'); await w.waitForTimeout(800); await w.keyboard.press('Escape'); await w.waitForTimeout(800);
  await w.evaluate(() => { location.hash = '#/read'; }); await shot('read');
  await w.evaluate(() => { location.hash = '#/series/1'; }); await shot('read-series');
  await w.click('.btn.gold[data-read]'); await w.waitForTimeout(1200); await shot('reader');
  await w.keyboard.press('Escape'); await w.waitForTimeout(500);
  await w.evaluate(() => { location.hash = '#/request'; }); await shot('request');
  await w.evaluate(() => { location.hash = '#/request-item/tv/103'; }); await shot('request-tv');
  await w.click('[data-send]'); await w.waitForTimeout(600);
  await w.evaluate(() => { location.hash = '#/request-item/manga/manga:104'; }); await shot('request-manga');
  await w.evaluate(() => { location.hash = '#/search/Star'; }); await shot('search');
  await w.evaluate(() => { location.hash = '#/requests'; }); await shot('mine');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
