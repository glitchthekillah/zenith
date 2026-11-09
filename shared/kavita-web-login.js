'use strict';
// The probe lives in kavita-probe.js so the desktop app (Rust) and the tests share one copy.
const src = require('fs').readFileSync(require('path').join(__dirname, 'kavita-probe.js'), 'utf8').trim();
module.exports = { probeScript: '(' + src + ')()' };
