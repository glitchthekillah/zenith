// npm run release: puts everything in dist/ for this version on the GitHub release v<version>,
// with release-notes/v<version>.md as the description. Needs the GitHub CLI (gh auth login once).
// Push your commit first: the release is made from what's on GitHub.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${version}`, out = path.join(root, 'dist'), notes = path.join(root, 'release-notes', `${tag}.md`);
const files = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.includes(version) || f === 'latest.json').map((f) => path.join(out, f)) : [];
if (!files.length) { console.error(`Nothing for ${version} in dist/. Run npm run dist first.`); process.exit(1); }
if (!fs.existsSync(notes)) { console.error(`Write the description first: release-notes/${tag}.md`); process.exit(1); }
const gh = (args) => execFileSync('gh', args, { cwd: root, stdio: 'inherit' });
let exists = true;
try { execFileSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' }); } catch { exists = false; }
if (exists) {
  gh(['release', 'upload', tag, ...files, '--clobber']);
  gh(['release', 'edit', tag, '--notes-file', notes, '--title', version]);
} else {
  gh(['release', 'create', tag, ...files, '--title', version, '--notes-file', notes, '--latest']);
}
console.log(`\nDone: ${files.map((f) => path.basename(f)).join(', ')}`);
