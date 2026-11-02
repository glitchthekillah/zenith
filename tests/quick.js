// Opens the app on a page and saves a screenshot: node tests/quick.js '#/home' out.png
const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox'] });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.waitForTimeout(1200); await w.evaluate((h) => { location.hash = h; }, process.argv[2] || '#/home'); await w.waitForTimeout(2500);
  console.log('liquid', await w.evaluate(() => document.body.classList.contains('liquid')), errs.join(' | '));
  await w.screenshot({ path: process.argv[3] || '/tmp/q.png' }); await app.close();
})();
