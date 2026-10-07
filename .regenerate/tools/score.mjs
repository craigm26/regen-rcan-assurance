#!/usr/bin/env node
// usage: score.mjs --impl <dir> --suite <dir> [--out score.json]
// Runs REGEN.json build and test, then the given suite; counts lines per SPEC § Budgets;
// lists dependencies. Writes JSON.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const IMPL = resolve(opt('--impl') ?? ''), SUITE = resolve(opt('--suite') ?? ''), OUT = opt('--out');
if (!opt('--impl') || !opt('--suite')) { console.error('usage: score.mjs --impl <dir> --suite <dir> [--out score.json]'); process.exit(2); }

const regen = JSON.parse(readFileSync(join(IMPL, 'REGEN.json'), 'utf8'));
const pick = (v) => (v == null ? '' : typeof v === 'string' ? v : v[process.platform] ?? v.default ?? '');
const sh = (cmd) => {
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd: IMPL, shell: true, encoding: 'utf8', timeout: 900000 });
  return { cmd, code: r.status, ms: Date.now() - t0, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

const build = pick(regen.build).trim() ? sh(pick(regen.build)) : { cmd: '', code: 0, ms: 0, out: '' };
const test = pick(regen.test).trim() ? sh(pick(regen.test)) : { cmd: '', code: null, ms: 0, out: 'no test command' };

// Own-test counts: node:test ("# pass N" / "# fail N") or unittest ("Ran N tests" + "FAILED (failures=a, errors=b)").
function counts(out, code) {
  const np = out.match(/^[#ℹ] pass (\d+)/m), nf = out.match(/^[#ℹ] fail (\d+)/m);
  if (np) return { passed: +np[1], failed: nf ? +nf[1] : 0 };
  const ran = out.match(/Ran (\d+) tests?/);
  if (ran) {
    const n = +ran[1];
    const f = out.match(/FAILED \(([^)]*)\)/);
    let failed = 0;
    if (f) for (const m of f[1].matchAll(/(failures|errors)=(\d+)/g)) failed += +m[2];
    return { passed: n - failed, failed };
  }
  return { passed: null, failed: null, note: `unparsed; exit ${code}` };
}
const own = { ...counts(test.out, test.code), exit: test.code };

// Lines per SPEC § Budgets.
const files = [];
const walk = (d, rel = '') => {
  for (const n of readdirSync(d)) {
    if (['node_modules', '.git', 'bin', '__pycache__'].includes(n)) continue;
    const p = join(d, n), r = rel ? `${rel}/${n}` : n;
    if (statSync(p).isDirectory()) walk(p, r); else files.push(r);
  }
};
walk(IMPL);
const exts = regen.lang === 'ts' ? ['.ts', '.mts', '.mjs', '.js'] : regen.lang === 'py' ? ['.py'] : ['.go'];
const isTest = (r) => /(^|\/)(test|tests)\//.test(r) || /\.test\./.test(basename(r)) || /_test\./.test(basename(r)) || /^test_.*\.py$/.test(basename(r));
const perFile = {};
let loc = 0;
for (const r of files.filter((f) => exts.includes(extname(f)) && !isTest(f))) {
  const n = readFileSync(join(IMPL, r), 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
  perFile[r] = n; loc += n;
}

// Dependencies.
const deps = [];
if (existsSync(join(IMPL, 'package.json'))) {
  const p = JSON.parse(readFileSync(join(IMPL, 'package.json'), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const d of Object.keys(p[k] ?? {})) deps.push(`${k}:${d}`);
}
for (const f of ['requirements.txt', 'pyproject.toml', 'Pipfile', 'go.sum']) if (existsSync(join(IMPL, f))) deps.push(`file:${f}`);

// Suite.
const tmp = mkdtempSync(join(tmpdir(), 'score-'));
const rep = join(tmp, 'suite.json');
const suite = spawnSync(process.execPath, [join(SUITE, 'run.mjs'), '--impl', IMPL, '--json', rep], { encoding: 'utf8', timeout: 1800000 });
const suiteReport = existsSync(rep) ? JSON.parse(readFileSync(rep, 'utf8')) : null;

const score = {
  impl: IMPL, suite: SUITE, platform: process.platform, node: process.version,
  build: { cmd: build.cmd, exit: build.code, ms: build.ms },
  own_tests: own, own_tests_output_tail: test.out.slice(-2000),
  suite: suiteReport ? { passed: suiteReport.passed, total: suiteReport.total, advisory: suiteReport.advisory, skipped: suiteReport.skipped, na: suiteReport.na,
    failing: suiteReport.failing.map((f) => ({ case: f.case, reqs: f.reqs })) } : { error: (suite.stdout + suite.stderr).slice(-2000) },
  suite_stdout: suite.stdout.slice(0, 20000),
  suite_failures: suiteReport?.failing ?? [],
  loc, loc_max: 500, loc_per_file: perFile, deps,
};
if (OUT) writeFileSync(OUT, JSON.stringify(score, null, 1));
console.log(`build exit ${build.code}; own tests ${own.passed}/${(own.passed ?? 0) + (own.failed ?? 0)} (exit ${own.exit}); suite ${suiteReport ? `${suiteReport.passed}/${suiteReport.total}` : 'ERROR'}; loc ${loc}/500; deps [${deps.join(', ')}]`);
