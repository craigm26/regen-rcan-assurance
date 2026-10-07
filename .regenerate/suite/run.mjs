#!/usr/bin/env node
// Spec suite runner. Node standard library only.
//   node .regenerate/suite/run.mjs --impl <dir> [--json report.json] [--reference] [--na <list>] [--only <substring>]
// --reference: the implementation is the reference adapter. Cases marked n/a for it are excluded
// from X/Y; validateEnvelope compares only `valid`, and verifyChain compares only `findings`
// (the earlier implementation has no error-path contract and no head/tail result).
// --na op,kind,id,...: with --reference, also n/a every case whose op, check kind or id is listed
// (for a secondary reference that lacks a whole surface, such as a command line).
// Prints `passed X/Y (advisory A/B, skipped S, n/a N)`; exits 0 only if every non-advisory case
// passed and traceability holds.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCases, specExamples } from './cases.mjs';
import { sha256Text } from './oracle.mjs';

const SUITE = import.meta.dirname;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const IMPL = opt('--impl') && resolve(opt('--impl'));
const JSON_OUT = opt('--json');
const AS_REFERENCE = args.includes('--reference');
const ONLY = opt('--only');
const NA = new Set((opt('--na') ?? '').split(',').filter(Boolean));
if (NA.size && !AS_REFERENCE) { console.error('--na needs --reference'); process.exit(2); }
const isNa = (c) => AS_REFERENCE && (c.na?.includes('reference') || NA.has(c.id) || NA.has(c.check.kind) || NA.has(c.check.op));
if (!IMPL) { console.error('usage: run.mjs --impl <dir> [--json report.json] [--reference]'); process.exit(2); }

// ---------- traceability, and the spec's own examples against the suite's model
const spec = readFileSync(join(SUITE, '..', 'SPEC.md'), 'utf8');
const definedReqs = new Set([...spec.matchAll(/\*\*(REQ-[A-Z]+-\d{3})\.\*\*/g)].map((m) => m[1]));
const openIds = new Set([...spec.matchAll(/\*\*(OPEN-[A-Z]+-\d{3})\.\*\*/g)].map((m) => m[1]));
const cases = buildCases().filter((c) => !ONLY || c.id.includes(ONLY));
const trace = [];
const ids = new Set();
for (const c of cases) {
  if (ids.has(c.id)) trace.push(`duplicate case id ${c.id}`);
  ids.add(c.id);
  if (!c.reqs?.length) trace.push(`case ${c.id} cites no REQ`);
  for (const r of c.reqs ?? []) {
    if (openIds.has(r) || r.startsWith('OPEN-')) trace.push(`case ${c.id} cites open item ${r}`);
    else if (!definedReqs.has(r)) trace.push(`case ${c.id} cites unknown ${r}`);
  }
}
if (!ONLY) for (const r of definedReqs) if (!cases.some((c) => c.reqs.includes(r))) trace.push(`${r} has no case`);
const examples = specExamples(spec);
if (examples.length !== 9) trace.push(`SPEC § 2.6 has ${examples.length} example rows, expected 9`);
for (const e of examples) if (!e.ok) trace.push(`SPEC § 2.6 example ${e.input}: model gives ${e.got}, SPEC says ${e.want}`);
const HASH_EXAMPLE = 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862';
if (sha256Text({ a: 1 }) !== HASH_EXAMPLE || !spec.includes(HASH_EXAMPLE)) trace.push('SPEC § 3 hash example does not match the model');
if (trace.length) { console.error('TRACEABILITY FAILED:\n  ' + trace.join('\n  ')); process.exit(2); }

// ---------- REGEN.json
const pick = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : v[process.platform] ?? v.default ?? '');
let regen = null, regenErr = null;
try { regen = JSON.parse(readFileSync(join(IMPL, 'REGEN.json'), 'utf8')); } catch (e) { regenErr = String(e.message); }

function shell(cmd) {
  const r = spawnSync(cmd, { cwd: IMPL, shell: true, encoding: 'utf8', timeout: 600000 });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
let buildFailed = null;
if (regen && pick(regen.build).trim()) {
  const b = shell(pick(regen.build));
  if (b.code !== 0) buildFailed = `build exited ${b.code}: ${b.out.slice(-500)}`;
}
const words = (k) => pick(regen?.[k]).split(' ').filter(Boolean);

// ---------- driver batches
function runDriver(lines) {
  return new Promise((done) => {
    const w = words('driver');
    if (!w.length) return done({ code: null, stdout: Buffer.alloc(0), stderr: 'no driver command', spawnError: true });
    let child;
    try { child = spawn(w[0], w.slice(1), { cwd: IMPL, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) {
      return done({ code: null, stdout: Buffer.alloc(0), stderr: String(e), spawnError: true });
    }
    const out = [], err = [];
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout: Buffer.concat(out), stderr: String(e), spawnError: true }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }); });
    child.stdin.on('error', () => {});
    child.stdin.end(lines.join('\n') + '\n');
  });
}

const batches = new Map();
for (const c of cases) {
  if (!c.batch) continue;
  if (isNa(c)) continue;
  const key = c.lines ? `${c.batch}:${c.id}` : c.batch;
  if (!batches.has(key)) batches.set(key, { lines: c.lines ?? [], index: new Map(), custom: !!c.lines });
  const b = batches.get(key);
  if (!b.custom && c.line !== undefined) {
    if (b.index.has(c.line)) throw new Error(`two cases send the same line: ${c.id}`);
    b.index.set(c.line, b.lines.length);
    b.lines.push(c.line);
  }
  c._batch = key;
}
// The id the driver must echo for a line: a string id of a JSON object line, else null.
const expectedId = (line) => {
  try { const v = JSON.parse(line); return v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string' ? v.id : null; } catch { return null; }
};
const batchOut = new Map();
if (regen && !buildFailed) {
  for (const [key, b] of batches) {
    const r = await runDriver(b.lines);
    const text = r.stdout.toString('utf8');
    const parts = text.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    const parsed = parts.map((p) => { try { return JSON.parse(p); } catch { return undefined; } });
    batchOut.set(key, { ...r, parts, parsed, expectedCount: b.lines.filter((l) => l.trim() !== '').length, b });
  }
}

// ---------- comparison
const sameJson = (a, b) => {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join('\0') !== kb.join('\0')) return false;
  return ka.every((k) => sameJson(a[k], b[k]));
};
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// REQ-CH-005: a finding's `detail` (a string) is open; everything else is compared.
const normFindings = (fs) => (Array.isArray(fs) ? fs.map((f) => {
  if (!isObj(f) || typeof f.detail !== 'string') return f;
  const { detail: _d, ...rest } = f; return rest;
}) : fs);
// REQ-EV-001 / OPEN-EV-001: error order is open.
const errKey = (e) => (isObj(e) ? `${e.path}\u0000${e.code}` : JSON.stringify(e));
const normEnvelopeResult = (v) => (isObj(v) && Array.isArray(v.errors) ? { ...v, errors: [...v.errors].sort((a, b) => (errKey(a) < errKey(b) ? -1 : errKey(a) > errKey(b) ? 1 : 0)) } : v);
function normResult(op, v) {
  if (op === 'validateEnvelope') return AS_REFERENCE ? (isObj(v) ? { valid: v.valid } : v) : normEnvelopeResult(v);
  if (op === 'verifyChain' && AS_REFERENCE) return isObj(v) ? { findings: normFindings(v.findings) } : v;
  if (['verifyChain', 'auditAuthority', 'replay'].includes(op) && isObj(v)) return { ...v, findings: normFindings(v.findings) };
  return v;
}
const normReport = (v) => (isObj(v) ? { ...v, envelope: normEnvelopeResult(v.envelope), findings: normFindings(v.findings) } : v);

// ---------- static checks
function staticCheck(test) {
  if (!regen) return `REGEN.json unreadable: ${regenErr}`;
  if (test === 'regen') {
    for (const k of ['lang', 'build', 'test', 'driver', 'cli']) if (!(k in regen)) return `REGEN.json lacks ${k}`;
    if (!['ts', 'py'].includes(regen.lang) && !(AS_REFERENCE && regen.lang === 'ref')) return `lang ${regen.lang}`;
    for (const k of ['build', 'test', 'driver', 'cli']) {
      const v = regen[k];
      if (typeof v !== 'string' && !(isObj(v) && typeof v.default === 'string' && Object.values(v).every((x) => typeof x === 'string'))) return `${k} must be a string or an object of strings with "default"`;
    }
    for (const k of ['driver', 'cli']) {
      for (const v of [regen[k], ...(isObj(regen[k]) ? Object.values(regen[k]) : [])])
        if (typeof v === 'string' && /["'|<>&;`$]|\.cmd\b|\bnpx\b/.test(v)) return `${k} is not plain words: ${v}`;
      if (!words(k).length) return `${k} is empty`;
    }
    return null;
  }
  if (test === 'runtime') {
    for (const k of ['driver', 'cli']) {
      const w = words(k);
      if (regen.lang === 'ts') {
        if (pick(regen.build).trim()) return 'ts must run by type stripping (no build step)';
        if (w[0] !== 'node') return `ts ${k} starts with ${w[0]}`;
      } else if (!['py', 'python', 'python3'].includes(w[0])) return `py ${k} starts with ${w[0]}`;
    }
    return null;
  }
  const files = [];
  const walk = (d, rel = '') => {
    for (const n of readdirSync(d)) {
      if (['node_modules', '.git', 'bin', '__pycache__'].includes(n)) continue;
      const p = join(d, n), r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r); else files.push(r);
    }
  };
  walk(IMPL);
  const exts = regen.lang === 'ts' ? ['.ts', '.mts', '.mjs', '.js'] : ['.py'];
  const isTest = (r) => /(^|\/)(test|tests)\//.test(r) || /\.test\./.test(basename(r)) || /_test\./.test(basename(r)) || /^test_.*\.py$/.test(basename(r));
  const src = files.filter((r) => exts.includes(extname(r)) && !isTest(r));
  if (test === 'loc') {
    const n = src.reduce((s, r) => s + readFileSync(join(IMPL, r), 'utf8').split(/\r?\n/).filter((l) => l.trim()).length, 0);
    return n <= 500 ? null : `${n} non-blank source lines > 500`;
  }
  if (test === 'deps') {
    if (existsSync(join(IMPL, 'node_modules'))) return 'node_modules present';
    if (existsSync(join(IMPL, 'package.json'))) {
      const p = JSON.parse(readFileSync(join(IMPL, 'package.json'), 'utf8'));
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
        if (p[k] && Object.keys(p[k]).length) return `package.json has ${k}`;
    }
    if (regen.lang === 'ts') {
      for (const r of files.filter((f) => exts.includes(extname(f)))) {
        const t = readFileSync(join(IMPL, r), 'utf8');
        for (const m of t.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g))
          if (!/^(\.|node:)/.test(m[1])) return `${r} imports ${m[1]}`;
      }
      return null;
    }
    const py = `import ast,sys,os\nloc={os.path.splitext(f)[0] for r,_,fs in os.walk('.') for f in fs if f.endswith('.py')}|{d for d in os.listdir('.') if os.path.isdir(d)}\nbad=set()\nfor r,_,fs in os.walk('.'):\n  for f in fs:\n    if f.endswith('.py'):\n      t=ast.parse(open(os.path.join(r,f),encoding='utf-8').read())\n      for n in ast.walk(t):\n        ms=[a.name for a in n.names] if isinstance(n,ast.Import) else ([n.module] if isinstance(n,ast.ImportFrom) and n.module and n.level==0 else [])\n        for m in ms:\n          top=m.split('.')[0]\n          if top not in sys.stdlib_module_names and top not in loc: bad.add(top)\nprint(','.join(sorted(bad)))`;
    const w = words('driver');
    const r = spawnSync(w[0], [...w.slice(1, -1), '-c', py], { cwd: IMPL, encoding: 'utf8' });
    if (r.status !== 0) return `import scan failed: ${(r.stderr ?? '').slice(-200)}`;
    return r.stdout.trim() ? `non-stdlib imports: ${r.stdout.trim()}` : null;
  }
  return `unknown static test ${test}`;
}

// ---------- command line (REQ-CL-*): each case gets its own temporary folder of input files.
// The first argument is the subcommand; options and the --head value pass unchanged; every
// other argument names a file and is passed as an absolute path into that folder.
function cliCheck(c) {
  const w = words('cli');
  if (!w.length) return 'no cli command';
  const dir = mkdtempSync(join(tmpdir(), 'av-cli-'));
  try {
    for (const [name, text] of Object.entries(c.check.files)) {
      const p = join(dir, ...name.split('/'));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, typeof text === 'string' ? text : Buffer.from(text.base64, 'base64'));
    }
    const a = c.check.args.map((x, i) => (i === 0 || x.startsWith('--') || c.check.args[i - 1] === '--head' ? x : join(dir, ...x.split('/'))));
    const r = spawnSync(w[0], [...w.slice(1), ...a], { cwd: IMPL, timeout: 60000 });
    if (r.error) return `cli did not start: ${r.error.message}`;
    const out = r.stdout ?? Buffer.alloc(0);
    if (r.status !== c.check.exit) return `exit ${r.status} want ${c.check.exit}; stdout ${out.toString('utf8').slice(0, 200)}; stderr ${String(r.stderr ?? '').slice(-200)}`;
    if (c.check.report === undefined) return null;
    if (out.includes(0x0d)) return 'stdout contains CR';
    const text = out.toString('utf8');
    if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) return `stdout is not exactly one LF-terminated line: ${JSON.stringify(text.slice(0, 200))}`;
    let got;
    try { got = JSON.parse(text); } catch { return `stdout is not JSON: ${text.slice(0, 200)}`; }
    if (!sameJson(normReport(got), normReport(c.check.report))) return `report ${JSON.stringify(got).slice(0, 600)}\n      want ${JSON.stringify(c.check.report).slice(0, 600)}`;
    return null;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------- checks
const results = [];
for (const c of cases) {
  if (isNa(c)) { results.push({ id: c.id, reqs: c.reqs, status: 'n/a' }); continue; }
  let why = null;
  try {
    if (c.check.kind === 'static') why = staticCheck(c.check.test);
    else if (!regen) why = `REGEN.json unreadable: ${regenErr}`;
    else if (buildFailed) why = buildFailed;
    else if (c.check.kind === 'cli') why = cliCheck(c);
    else {
      const o = batchOut.get(c._batch);
      if (o.spawnError) why = `driver did not start: ${o.stderr}`;
      else if (c.check.kind === 'stdout') {
        const t = c.check.test;
        if (t === 'utf8') { try { new TextDecoder('utf-8', { fatal: true }).decode(o.stdout); } catch { why = 'stdout is not valid UTF-8'; } }
        else if (t === 'lf') { if (o.stdout.includes(0x0d)) why = 'stdout contains CR'; else if (o.stdout.length && o.stdout[o.stdout.length - 1] !== 0x0a) why = 'last line not LF-terminated'; }
        else if (t === 'count') {
          if (o.parts.length !== o.expectedCount) why = `${o.parts.length} response lines for ${o.expectedCount} requests`;
          else {
            const want = o.b.lines.filter((l) => l.trim() !== '').map(expectedId);
            const bad = o.parsed.findIndex((p, i) => !isObj(p) || p.id !== want[i]);
            if (bad >= 0) why = `response ${bad} is ${String(o.parts[bad]).slice(0, 120)}; want id ${JSON.stringify(want[bad])}`;
          }
        }
        else if (t === 'exit0') { if (o.code !== 0) why = `driver exit ${o.code}`; }
        else if (t === 'blank') { const got = o.parsed.map((p) => p?.id); if (got.join(',') !== 'blank-1,blank-2') why = `responses ${JSON.stringify(got)}`; }
        else if (t === 'continue') {
          if (o.parsed.length !== 2 || !sameJson(o.parsed[0], { id: null, error: 'bad_request' }) || !sameJson(o.parsed[1], { id: 'after', result: 'WzFd' })) why = `responses ${o.parts.join(' | ').slice(0, 300)}`;
        }
      } else {
        const idx = o.b.index.get(c.line);
        const resp = o.parsed[idx];
        if (resp === undefined && o.parts.length !== o.expectedCount) why = `no response (driver exit ${o.code}; ${o.parts.length}/${o.expectedCount} lines; stderr: ${o.stderr.slice(-300)})`;
        else if (!isObj(resp)) why = `unparseable response line: ${String(o.parts[idx]).slice(0, 200)}`;
        else if (c.check.kind === 'error') {
          if (!sameJson(resp, { id: c.check.id, error: c.check.category })) why = `got ${JSON.stringify(resp).slice(0, 300)}`;
        } else if ('error' in resp) why = `error response ${JSON.stringify(resp).slice(0, 300)}`;
        else if (c.check.kind === 'result') {
          const keys = Object.keys(resp).sort().join(',');
          if (keys !== 'id,result') why = `response members ${keys}, want id,result`;
          else if (resp.id !== (c.check.idOverride ?? c.id)) why = `id ${JSON.stringify(resp.id)}`;
          else if (!sameJson(normResult(c.check.op, resp.result), normResult(c.check.op, c.check.value))) why = `result ${JSON.stringify(resp.result).slice(0, 600)}\n      want ${JSON.stringify(c.check.value).slice(0, 600)}`;
        } else why = `unknown check kind ${c.check.kind}`;
      }
    }
  } catch (e) { why = `runner exception: ${e.stack}`; }
  results.push({ id: c.id, reqs: c.reqs, status: why ? 'fail' : 'pass', why: why ?? undefined, advisory: !!c.advisory });
}

const counted = results.filter((r) => r.status !== 'n/a' && !r.advisory);
const passed = counted.filter((r) => r.status === 'pass').length;
const adv = results.filter((r) => r.advisory && r.status !== 'n/a');
const na = results.filter((r) => r.status === 'n/a').length;
const failing = counted.filter((r) => r.status === 'fail');
console.log(`passed ${passed}/${counted.length} (advisory ${adv.filter((r) => r.status === 'pass').length}/${adv.length}, skipped 0, n/a ${na})`);
for (const f of failing) console.log(`  FAIL ${f.id} [${f.reqs.join(', ')}]\n      ${f.why}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({
  passed, total: counted.length, advisory: `${adv.filter((r) => r.status === 'pass').length}/${adv.length}`, skipped: 0, na,
  failing: failing.map((f) => ({ case: f.id, reqs: f.reqs, why: f.why })), results,
}, null, 1));
process.exit(failing.length ? 1 : 0);
