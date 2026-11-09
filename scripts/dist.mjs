// npm run dist: builds the installer for this computer (Windows: Setup .exe, Linux: AppImage and .deb)
// and puts everything to upload to the GitHub release in dist/, including latest.json for updates.
// Updates need a signing key, made once: npx tauri signer generate -w "$HOME/.tauri/zenith.key" (keep it safe).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version, repo = pkg.zenith?.repo || '';
const keyFile = path.join(os.homedir(), '.tauri', 'zenith.key');
const pubFile = path.join(root, 'src-tauri', 'updater.pub');
const env = { ...process.env };
let signed = false;

if (env.TAURI_SIGNING_PRIVATE_KEY || fs.existsSync(keyFile)) {
  if (!env.TAURI_SIGNING_PRIVATE_KEY) env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(keyFile, 'utf8').trim();
  // No password set = empty password. If you gave the key one, set TAURI_SIGNING_PRIVATE_KEY_PASSWORD before building.
  if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD == null) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '';
  // The public half goes inside the app so it can check updates are really yours
  if (!fs.readFileSync(pubFile, 'utf8').trim() && fs.existsSync(keyFile + '.pub')) {
    fs.writeFileSync(pubFile, fs.readFileSync(keyFile + '.pub', 'utf8').trim() + '\n');
    console.log('Added your public update key to src-tauri/updater.pub');
  }
  signed = !!fs.readFileSync(pubFile, 'utf8').trim();
}
if (!signed) console.log('\nNo update key found, building without self-updates. To turn them on, run once:\n  npx tauri signer generate -w "$HOME/.tauri/zenith.key"\n');

const pubkey = signed ? fs.readFileSync(pubFile, 'utf8').trim() : '';
const config = JSON.stringify({ bundle: { createUpdaterArtifacts: signed }, plugins: { updater: { pubkey, windows: { installMode: 'passive' } } } });
const cfgFile = path.join(os.tmpdir(), 'zenith-build.json');
fs.writeFileSync(cfgFile, config);
execSync(`npx tauri build --config "${cfgFile}"`, { cwd: root, env, stdio: 'inherit' });

// Collect the files to upload
const bundle = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const found = [];
for (const dir of ['nsis', 'appimage', 'deb']) {
  const d = path.join(bundle, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (f.includes(version) && /\.(exe|AppImage|deb|sig)$/.test(f)) { fs.copyFileSync(path.join(d, f), path.join(out, f)); found.push(f); }
}

// Portable Windows version: the app itself, no installer (needs WebView2, which Windows 10 and 11 have)
const exe = path.join(root, 'src-tauri', 'target', 'release', 'zenith.exe');
if (process.platform === 'win32' && fs.existsSync(exe)) {
  const name = `Zenith_${version}_x64-portable.exe`;
  fs.copyFileSync(exe, path.join(out, name));
  found.push(name);
}

// Linux builds made on another computer and copied into dist/ get signed here with your key
if (signed) for (const f of fs.readdirSync(out)) {
  const sig = path.join(out, f + '.sig');
  if (!f.includes(version) || !f.endsWith('.AppImage')) continue;
  if (fs.existsSync(sig) && fs.statSync(sig).mtimeMs >= fs.statSync(path.join(out, f)).mtimeMs) continue; // already signed
  // With the key file, pass only the file (the CLI refuses a key given twice)
  const useFile = fs.existsSync(keyFile), signEnv = { ...env };
  if (useFile) delete signEnv.TAURI_SIGNING_PRIVATE_KEY;
  execSync(`npx tauri signer sign ${useFile ? `-f "${keyFile}"` : ''} "${path.join(out, f)}"`, { cwd: root, env: signEnv, stdio: 'inherit' });
}
for (const f of fs.readdirSync(out)) if (f.includes(version) && !found.includes(f)) found.push(f);

// latest.json: merged, so Windows and Linux builds made on different computers end up in one file
if (signed && repo) {
  const file = path.join(out, 'latest.json');
  let latest = {};
  try { latest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (latest.version !== version) latest = { version, notes: '', pub_date: new Date().toISOString(), platforms: {} };
  const add = (platform, name) => {
    if (!found.includes(name) || !found.includes(name + '.sig')) return;
    latest.platforms[platform] = { signature: fs.readFileSync(path.join(out, name + '.sig'), 'utf8').trim(), url: `https://github.com/${repo}/releases/download/v${version}/${name}` };
  };
  for (const f of found) {
    if (f.endsWith('-setup.exe')) add('windows-x86_64', f);
    if (f.endsWith('.AppImage')) add('linux-x86_64', f);
  }
  fs.writeFileSync(file, JSON.stringify(latest, null, 2) + '\n');
  found.push('latest.json');
}
console.log(`\nReady in dist/:\n  ` + [...new Set(found)].join('\n  ') + `\n\nPublish with: npm run release`);
