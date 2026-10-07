#!/usr/bin/env node
// usage: ci-impl.mjs <lang>
// For impl/<lang>: read its latest promotion entry, add a worktree at that entry's spec tag,
// run the implementation's build and own tests, then that tag's suite against impl/<lang>.
// Exits non-zero on any failure. Node standard library and git only.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const lang = process.argv[2];
if (!lang) { console.error('usage: ci-impl.mjs <lang>'); process.exit(2); }
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const impl = join(root, 'impl', lang);
const promos = readFileSync(join(root, '.regenerate', 'ledger.jsonl'), 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => JSON.parse(l)).filter((e) => e.kind === 'promotion' && e.lang === lang);
const promo = promos[promos.length - 1];
if (!promo) { console.error(`no promotion entry for ${lang}`); process.exit(1); }
console.log(`impl/${lang}: ${promo.run} @ ${promo.spec_tag}`);

const regen = JSON.parse(readFileSync(join(impl, 'REGEN.json'), 'utf8'));
const pick = (v) => (v == null ? '' : typeof v === 'string' ? v : v[process.platform] ?? v.default ?? '');
const sh = (label, cmd) => {
  if (!cmd.trim()) { console.log(`${label}: (none)`); return; }
  console.log(`${label}: ${cmd}`);
  const r = spawnSync(cmd, { cwd: impl, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${label} failed (exit ${r.status})`); process.exit(1); }
};
sh('build', pick(regen.build));
sh('own tests', pick(regen.test));

const wt = mkdtempSync(join(tmpdir(), `spec-${lang}-`));
rmSync(wt, { recursive: true, force: true });
execFileSync('git', ['worktree', 'add', '--detach', wt, promo.spec_tag], { cwd: root, stdio: 'inherit' });
let code = 1;
try {
  const suite = join(wt, '.regenerate', 'suite', 'run.mjs');
  if (!existsSync(suite)) throw new Error(`no suite at ${promo.spec_tag}`);
  code = spawnSync(process.execPath, [suite, '--impl', impl], { stdio: 'inherit' }).status ?? 1;
} finally {
  execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
}
process.exit(code);
