const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(http) {
  const settings = { servers: { jellyfin: { url: 'https://example.test', token: 'existing' } } };
  const source = fs.readFileSync(path.join(__dirname, '../app/js/jellyfin.js'), 'utf8')
    .replace(/^import .*;\r?\n/m, '').replace(/\bexport /g, '');
  const context = { http, settings, save() {}, deviceId: 'test-device', VERSION: 'test', desktop: false };
  vm.runInNewContext(source + '\nthis.subject = { signIn, publicInfo, api };', context);
  return context.subject;
}

for (const status of [401, 403, 503]) {
  test(`fresh sign-in handles HTTP ${status} correctly`, async () => {
    const failure = Object.assign(new Error(status === 401 ? 'Your sign-in expired. Sign in again.' : 'Original server error'), { status });
    const api = client(async (url) => {
      if (url.endsWith('/System/Info/Public')) return { ServerName: 'Test' };
      throw failure;
    });
    await assert.rejects(api.signIn('https://example.test', 'test', 'test'), (error) => {
      assert.equal(error, failure);
      assert.equal(error.status, status);
      assert.equal(error.message, status === 401 ? 'Jellyfin did not accept that username or password.' : 'Original server error');
      return true;
    });
  });
}

test('signed-in API 401 errors keep the expired-sign-in message', async () => {
  const failure = Object.assign(new Error('Your sign-in expired. Sign in again.'), { status: 401 });
  const api = client(async () => { throw failure; });
  await assert.rejects(api.api('/Users/Me'), (error) => {
    assert.equal(error, failure);
    assert.equal(error.message, 'Your sign-in expired. Sign in again.');
    return true;
  });
});