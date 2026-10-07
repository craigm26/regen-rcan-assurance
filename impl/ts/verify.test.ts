import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canon, hashOf, GENESIS } from './lib.ts';

const here = import.meta.dirname;
const drive = (input: string) => spawnSync('node', ['driver.ts'], { cwd: here, input });
const ask = (op: string, inp: unknown, raw?: string) => {
  const r = drive(raw ?? JSON.stringify({ id: 'x', op, input: inp }) + '\n');
  return JSON.parse(r.stdout.toString().trim());
};
const result = (op: string, inp: unknown) => ask(op, inp).result;
const error = (op: string, inp: unknown) => ask(op, inp).error;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const goodEnv = () => ({
  envelope_version: '0.1', machine: { id: 'm', class: 'c' }, level: 'A1',
  workspace: { frame: 'w', keep_in: [[0, 0], [10, 0], [10, 10], [0, 10]], keep_out: [[[4, 4], [6, 4], [6, 6], [4, 6]]] },
  motion: { max_speed_mps: 1, max_turn_radps: 2 },
  stop: { category: 1, max_time_ms: 100, max_distance_m: 0 },
  heartbeat: { model_timeout_ms: 100, gate_timeout_ms: 100, on_loss: 'stop' },
});
const codes = (env: unknown) => result('validateEnvelope', { envelope: env }).errors.map((e: any) => e.path + ' ' + e.code).sort();

test('REQ-IF-002/003/004/005/007: protocol, blank lines, CRLF, errors', () => {
  const lines = [
    '{"id":"a","op":"canonical","input":{"value":1},"extra":1}\r',
    '  \t\r', '',
    '[1]', '{"id":5,"op":"canonical","input":{}}', 'NaN', '{"id":"b"}',
    '{"id":"c","op":"nope","input":{}}', '{"id":"d","op":"canonical"}', '{"id":"e","op":"canonical","input":{}}',
    '{"id":"f","op":"canonical","input":{"value":1e400}}', '{"id":"g","op":"canonical","input":{"value":"\\ud800"}}',
    '{"id":"h","op":"verifyChain","input":{"records":[],"expectedHead":5}}',
    '{"id":"i","op":"verifyChain","input":{"records":[{"seq":-1,"prev":"","hash":""}]}}',
  ];
  const r = drive(lines.join('\n'));
  assert.equal(r.status, 0);
  const out = r.stdout.toString();
  assert.ok(!out.includes('\r') && out.endsWith('\n'));
  assert.deepEqual(out.trim().split('\n').map((l) => JSON.parse(l)), [
    { id: 'a', result: 'MQ==' },
    { id: null, error: 'bad_request' }, { id: null, error: 'bad_request' }, { id: null, error: 'bad_request' },
    { id: 'b', error: 'unknown_op' }, { id: 'c', error: 'unknown_op' }, { id: 'd', error: 'bad_request' },
    { id: 'e', error: 'bad_request' }, { id: 'f', error: 'non_finite_number' }, { id: 'g', error: 'invalid_string' },
    { id: 'h', error: 'bad_request' }, { id: 'i', error: 'bad_request' },
  ]);
});

test('REQ-IF-006: numbers are binary64', () => {
  const raw = '{"id":"n","op":"canonical","input":{"value":[50,50.0,5e1,9007199254740993]}}\n';
  assert.equal(ask('', null, raw).result, b64('[50,50,50,9007199254740992]'));
});

const canonCases: [string, string][] = [
  ['{"b":1,"a":2,"c":3}', '{"a":2,"b":1,"c":3}'],
  ['{"x":50.0,"y":-0.0,"z":5e1}', '{"x":50,"y":0,"z":50}'],
  ['[1e21,1e-7,1e16,0.000001,0.1]', '[1e+21,1e-7,10000000000000000,0.000001,0.1]'],
  ['[123456789012345680000,9007199254740993,1.5e-10]', '[123456789012345680000,9007199254740992,1.5e-10]'],
  ['{"name":"Café ☕","path":"a/b"}', '{"name":"Café ☕","path":"a/b"}'],
  ['["\\u001f","\\u0008\\t\\n\\f\\r","\\"\\\\"]', '["\\u001f","\\b\\t\\n\\f\\r","\\"\\\\"]'],
  ['{"\\ue000":1,"\\ud83d\\ude00":2}', '{"😀":2,"\ue000":1}'],
  ['{"b":0,"10":1,"9":2,"":3}', '{"":3,"10":1,"9":2,"b":0}'],
  ['{"ok":true,"no":false,"none":null,"list":[],"obj":{}}', '{"list":[],"no":false,"none":null,"obj":{},"ok":true}'],
  ['"\\u007f\\u2028/"', '"\u007f\u2028/"'],
  ['[1e300,-1.5,0.5e-6,123e-20]', '[1e+300,-1.5,5e-7,1.23e-18]'],
];
test('REQ-CJ-001..003, 006: canonical examples', () => {
  for (const [inp, out] of canonCases) {
    const raw = `{"id":"k","op":"canonical","input":{"value":${inp}}}\n`;
    assert.equal(ask('', null, raw).result, b64(out), inp);
  }
});
test('REQ-CJ-004/005: no canonical form', () => {
  assert.equal(error('canonical', { value: { a: [Infinity] } }) ?? 'x', 'x'); // Infinity not JSON-serializable here
  const r = ask('', null, '{"id":"z","op":"canonical","input":{"value":{"\\udc00":1}}}\n');
  assert.equal(r.error, 'invalid_string');
  const r2 = ask('', null, '{"id":"z","op":"recordHash","input":{"record":{"a":[-1e999]}}}\n');
  assert.equal(r2.error, 'non_finite_number');
  assert.throws(() => canon(NaN));
});

test('REQ-HA-001..003: hashes', () => {
  const h = 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862';
  assert.equal(result('envelopeHash', { envelope: { signature: 'x', a: 1 } }), h);
  assert.equal(result('recordHash', { record: { a: 1, hash: 'y' } }), h);
  assert.equal(result('envelopeHash', { envelope: { a: { signature: 1 } } }), hashOf({ a: { signature: 1 } }));
  assert.equal(result('recordHash', { record: { signature: 1 } }), hashOf({ signature: 1 }));
});

test('REQ-EV-001..003: validate examples', () => {
  assert.deepEqual(result('validateEnvelope', { envelope: goodEnv() }), { valid: true, errors: [] });
  const e1: any = goodEnv(); e1.heartbeat.on_loss = 'continue';
  assert.deepEqual(codes(e1), ['/heartbeat/on_loss invalid_value']);
  const e2: any = goodEnv(); e2.level = 'L3';
  assert.deepEqual(codes(e2), ['/level invalid_value']);
  const e3: any = goodEnv(); delete e3.stop;
  assert.deepEqual(codes(e3), ['/stop required']);
  const e4: any = goodEnv(); e4.motion.max_sped_mps = 5;
  assert.deepEqual(codes(e4), ['/motion/max_sped_mps unknown_member']);
  assert.deepEqual(result('validateEnvelope', { envelope: [1] }), { valid: false, errors: [{ path: '', code: 'type' }] });
});
test('REQ-EV-004: field rules', () => {
  const m = (f: (e: any) => void) => { const e: any = goodEnv(); f(e); return codes(e); };
  assert.deepEqual(m((e) => { e.envelope_version = '0.1\n'; }), ['/envelope_version invalid_value']);
  assert.deepEqual(m((e) => { e.envelope_version = '1.0'; }), ['/envelope_version invalid_value']);
  assert.deepEqual(m((e) => { e.machine.id = ''; e.machine.mass_kg = 0; }), ['/machine/id invalid_value', '/machine/mass_kg invalid_value']);
  assert.deepEqual(m((e) => { e.motion.max_speed_mps = true; }), ['/motion/max_speed_mps type']);
  assert.deepEqual(m((e) => { e.stop.category = 3; e.stop.max_time_ms = 300.5; }), ['/stop/category invalid_value', '/stop/max_time_ms type']);
  assert.deepEqual(m((e) => { e.stop.max_time_ms = 300.0; e.stop.max_distance_m = -1; }), ['/stop/max_distance_m invalid_value']);
  assert.deepEqual(m((e) => { e.force = { max_payload_kg: 0, max_contact_force_n: 0 }; }), ['/force/max_contact_force_n invalid_value']);
  assert.deepEqual(m((e) => { e.sensing = { max_state_age_ms: 5 }; e.signature = 'ed25519:abc'; e.authority = { resolver: 'local' }; }), []);
  assert.deepEqual(m((e) => { e.signature = 'ABC:abc'; }), ['/signature invalid_value']);
  assert.deepEqual(m((e) => { e.signature = 'a:b\u2028'; }), ['/signature invalid_value']);
  assert.deepEqual(m((e) => { e.authority = { resolver: 'x', extra: 1 }; }), ['/authority/extra unknown_member', '/authority/resolver invalid_value']);
  assert.deepEqual(m((e) => { e.extra = 1; e['a/b~'] = 1; }), ['/a~1b~0 unknown_member', '/extra unknown_member']);
  assert.deepEqual(m((e) => { e.heartbeat = {}; }), ['/heartbeat/gate_timeout_ms required', '/heartbeat/model_timeout_ms required', '/heartbeat/on_loss required']);
});
test('REQ-EV-005: points and polygons', () => {
  const m = (f: (e: any) => void) => { const e: any = goodEnv(); f(e); return codes(e); };
  assert.deepEqual(m((e) => { e.workspace.keep_in = [[0, 0], [1], [1, 1]]; }), ['/workspace/keep_in/1 invalid_value']);
  assert.deepEqual(m((e) => { e.workspace.keep_in = [[0, 0], ['a', 1, 2], [1, 1]]; }), ['/workspace/keep_in/1 invalid_value', '/workspace/keep_in/1/0 type']);
  assert.deepEqual(m((e) => { e.workspace.keep_in = [[0, 0], [1, 1]]; }), ['/workspace/keep_in invalid_value']);
  assert.deepEqual(m((e) => { e.workspace.keep_out = [5]; e.workspace.z_range_m = [2, 1]; }), ['/workspace/keep_out/0 type']);
  assert.deepEqual(m((e) => { e.workspace.z_range_m = [1, 2, 3]; }), ['/workspace/z_range_m invalid_value']);
  assert.deepEqual(m((e) => { e.workspace.keep_in = 'x'; }), ['/workspace/keep_in type']);
});
test('REQ-EV-006/007: proximity and uniqueness', () => {
  const m = (f: (e: any) => void) => { const e: any = goodEnv(); f(e); return codes(e); };
  assert.deepEqual(m((e) => { e.proximity = [{ when: { human_within_m: 1 }, action: 'stop' }, { when: { human_within_m: 2 }, max_speed_mps: 0 }]; }), []);
  assert.deepEqual(m((e) => { e.proximity = [{ when: { human_within_m: 1 }, action: 5 }]; }), ['/proximity/0/action type']);
  assert.deepEqual(m((e) => { e.proximity = [{ when: { human_within_m: 1 } }]; }), ['/proximity/0 invalid_value']);
  assert.deepEqual(m((e) => { e.proximity = [{ when: { human_within_m: 1 }, action: 'stop', max_speed_mps: 1 }]; }), ['/proximity/0 invalid_value']);
  assert.deepEqual(m((e) => { e.proximity = [{ when: { human_within_m: 0, x: 1 }, action: 'stop' }]; }), ['/proximity/0/when/human_within_m invalid_value', '/proximity/0/when/x unknown_member']);
  assert.deepEqual(m((e) => { e.authority = { required_for: ['a', 'a', 'a', 1] }; }), ['/authority/required_for invalid_value', '/authority/required_for/3 type']);
});

const mk = (recs: any[]) => {
  let prev = GENESIS;
  return recs.map((r, i) => { const x: any = { seq: i, prev, ...r }; x.hash = hashOf(x, 'hash'); prev = x.hash; return x; });
};
test('REQ-CH-001..005: verifyChain', () => {
  const c = mk([{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.deepEqual(result('verifyChain', { records: c }), { findings: [], head: c[2].hash, tail: 'unverified' });
  assert.deepEqual(result('verifyChain', { records: c.slice(0, 2) }).tail, 'unverified'); // truncation undetected
  assert.deepEqual(result('verifyChain', { records: [] }), { findings: [], head: GENESIS, tail: 'unverified' });
  assert.deepEqual(result('verifyChain', { records: c, expectedHead: c[2].hash }).tail, 'anchored');
  assert.deepEqual(result('verifyChain', { records: c.slice(0, 2), expectedHead: c[2].hash }).findings, [{ seq: null, code: 'HEAD_MISMATCH' }]);
  assert.deepEqual(result('verifyChain', { records: [], expectedHead: 'x' }).findings, [{ seq: null, code: 'HEAD_MISMATCH' }]);
  const bad = [{ ...c[1], seq: 5 }, { ...c[2], seq: 9, prev: 'zz' }];
  const f = result('verifyChain', { records: bad }).findings.map((x: any) => x.seq + x.code);
  assert.deepEqual(f, ['5BAD_GENESIS', '5PREV_MISMATCH', '5HASH_MISMATCH', '9SEQ_GAP', '9PREV_MISMATCH', '9HASH_MISMATCH']);
  assert.equal(error('verifyChain', { records: [{ seq: 1.5, prev: '', hash: '' }] }), 'bad_request');
  assert.equal(error('verifyChain', { records: [{ seq: 1, prev: 1, hash: '' }] }), 'bad_request');
  assert.equal(error('verifyChain', { records: [1] }), 'bad_request');
  assert.equal(error('replay', { records: [{ seq: '1' }], envelope: {} }), 'bad_request');
  assert.deepEqual(result('auditAuthority', { records: [{ seq: 1 }], envelope: {} }), { findings: [] });
});

test('REQ-AA-001/002: authority audit', () => {
  const env = { authority: { required_for: ['motion', 'grip', 5] } };
  const recs = [
    { seq: 0, decision: 'allow' }, { seq: 1, decision: 'clamp', cmd: { kind: 'grip' }, principal: 'p', authority: '' },
    { seq: 2, decision: 'reject' }, { seq: 3, decision: 'allow', cmd: { kind: 'other' } },
    { seq: 4, decision: 'allow', cmd: null, principal: 'p', authority: 'a' }, { seq: 5, decision: 'stop' },
    { seq: 6, decision: 'allow', cmd: { kind: 5 }, principal: 0, authority: true },
  ];
  assert.deepEqual(result('auditAuthority', { records: recs, envelope: env }).findings.map((x: any) => x.seq + x.code),
    ['0NO_PRINCIPAL', '0NO_AUTHORITY', '1NO_AUTHORITY', '6NO_PRINCIPAL', '6NO_AUTHORITY']);
  assert.deepEqual(result('auditAuthority', { records: recs, envelope: { authority: { required_for: 'motion' } } }), { findings: [] });
});

const rp = (env: any, recs: any[]) => {
  const H = hashOf(env, 'signature');
  return result('replay', { envelope: env, records: recs.map((r, i) => ({ seq: i, envelope: H, ...r })) }).findings.map((x: any) => x.seq === null ? x.code + ':' + x.field : x.seq + x.code);
};
test('REQ-RP-001..005: replay', () => {
  const env = goodEnv();
  assert.deepEqual(rp(env, [{ decision: 'allow', cmd: { linear_mps: 0.5 }, applied: { linear_mps: 0.5 } }]), []);
  assert.deepEqual(rp({ ...env, signature: 'a:b' }, [{ decision: 'reject', applied: null, reason: 'r' }]), []);
  const recs: any[] = [
    { envelope: 'bad', decision: 'allow', cmd: {}, applied: {} },
    { decision: 'jump' },
    { decision: 'reject', reason: '' },
    { decision: 'reject', applied: 0, reason: 'r' },
    { decision: 'allow', cmd: {} },
    { decision: 'stop', applied: { linear_mps: 0.1, angular_radps: 0 }, reason: 'r' },
    { decision: 'clamp', applied: { linear_mps: -2, angular_radps: 3, target: [20, 5] }, reason: '' },
    { decision: 'allow', cmd: { linear_mps: 1, target: [5, 5] }, applied: { linear_mps: 1, target: [5, 5] } },
    { decision: 'allow', cmd: { linear_mps: 1 }, applied: { linear_mps: 0.9 } },
    { decision: 'allow', cmd: { target: [0, 0] }, applied: { target: [0, 0] } },
    { decision: 'allow', applied: { target: [4, 5] } },
  ];
  assert.deepEqual(rp(env, recs), [
    '0ENVELOPE_MISMATCH', '1UNKNOWN_DECISION', '2REJECT_APPLIED', '2MISSING_REASON', '3REJECT_APPLIED',
    '4APPLIED_NOT_OBJECT', '5STOP_WITH_MOTION',
    '6SPEED_EXCEEDED', '6TURN_EXCEEDED', '6OUTSIDE_KEEP_IN', '6MISSING_REASON',
    '7INSIDE_KEEP_OUT', '8ALLOW_MODIFIED', '10INSIDE_KEEP_OUT', '10ALLOW_MODIFIED',
  ]);
  // unchecked fields: sorted, distinct, only judged-or-not rules
  assert.deepEqual(rp(env, [
    { decision: 'allow', cmd: {}, applied: { kind: 'x', gripper: 1, linear_mps: '0.4', target: [1], z_m: 1 } },
    { decision: 'stop', applied: { target: [0, 0], gripper: 2 }, reason: 'r' },
    { decision: 'allow', cmd: null, applied: { '\ud83d\ude00': 1, '\ue000': 1 } },
  ]).filter((x: string) => x.includes(':')), [
    'UNCHECKED_FIELDS:gripper', 'UNCHECKED_FIELDS:linear_mps', 'UNCHECKED_FIELDS:target', 'UNCHECKED_FIELDS:z_m',
    'UNCHECKED_FIELDS:\ud83d\ude00', 'UNCHECKED_FIELDS:\ue000',
  ]);
  // bounds absent or non-numeric, polygons malformed => skipped
  const loose = { motion: { max_speed_mps: '0.5' }, workspace: { keep_in: [[0, 0], [1, 1]], keep_out: [[[0, 0], [1, 1]], 'x'] } };
  assert.deepEqual(rp(loose, [{ decision: 'allow', cmd: { linear_mps: 9, target: [0.5, 0.5] }, applied: { linear_mps: 9, target: [0.5, 0.5] } }]), []);
  // boundary inclusive
  assert.deepEqual(rp(env, [{ decision: 'allow', cmd: { target: [10, 5] }, applied: { target: [10, 5] } }, { decision: 'allow', cmd: { target: [4, 4] }, applied: { target: [4, 4] } }]), ['1INSIDE_KEEP_OUT']);
  // errors from canonical forms: only allow records reaching ALLOW_MODIFIED
  assert.equal(ask('', null, `{"id":"r","op":"replay","input":{"envelope":{},"records":[{"seq":0,"decision":"allow","applied":{"v":1e999}}]}}\n`).error, 'non_finite_number');
  assert.equal(ask('', null, `{"id":"r","op":"replay","input":{"envelope":{},"records":[{"seq":0,"decision":"clamp","reason":"r","applied":{"v":1e999}}]}}\n`).result.findings.length, 2);
  assert.equal(ask('', null, `{"id":"r","op":"replay","input":{"envelope":{"signature":1e999},"records":[]}}\n`).result.findings.length, 0);
});

const cli = (args: string[]) => spawnSync('node', ['verify.ts', ...args], { cwd: here });
test('REQ-CL-001..004: command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-'));
  const w = (n: string, v: string) => { const p = join(dir, n); writeFileSync(p, v); return p; };
  const env = goodEnv();
  const H = hashOf(env, 'signature');
  const chain = mk([{ envelope: H, decision: 'allow', cmd: { linear_mps: 1, gripper: 1 }, applied: { linear_mps: 1, gripper: 1 } }, { envelope: H, decision: 'reject', applied: null, reason: 'r' }]);
  const cf = w('c.json', JSON.stringify(chain)), ef = w('e.json', JSON.stringify(env));
  let r = cli(['verify', cf, '--json']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout.toString()), { ok: true, records: 2, tail: 'unverified', envelope: null, findings: [] });
  r = cli(['verify', cf, ef, '--head', chain[1].hash, '--json']);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout.toString());
  assert.deepEqual(o.findings, [{ seq: null, code: 'UNCHECKED_FIELDS', field: 'gripper' }]);
  assert.deepEqual([o.ok, o.tail, o.envelope], [true, 'anchored', { valid: true, errors: [] }]);
  assert.ok(r.stdout.toString().endsWith('}\n'));
  r = cli(['verify', '--head', 'sha256:nope', cf, '--json', ef]);
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout.toString()).findings.map((f: any) => f.code), ['HEAD_MISMATCH', 'UNCHECKED_FIELDS']);
  const badEnv = w('be.json', JSON.stringify({ ...env, level: 'Z' }));
  r = cli(['verify', cf, badEnv, '--json']);
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout.toString()).ok, false);
  assert.equal(cli(['verify', cf, ef]).status, 0);
  assert.equal(cli(['verify', cf, badEnv]).status, 1);
  // usage errors, decided before any file is opened
  for (const a of [[], ['check', cf], ['verify'], ['verify', cf, '--bogus'], ['verify', cf, '--head'], ['verify', cf, ef, cf], ['verify', '/no/such', '--x']]) {
    assert.equal(cli(a).status, 2, a.join(' '));
  }
  // bad input
  assert.equal(cli(['verify', '/no/such/file']).status, 3);
  assert.equal(cli(['verify', w('n.json', 'NaN')]).status, 3);
  assert.equal(cli(['verify', w('o.json', '{}')]).status, 3);
  assert.equal(cli(['verify', w('s.json', '[{"seq":0}]')]).status, 3);
  assert.equal(cli(['verify', cf, w('a.json', '[]')]).status, 3);
  assert.equal(cli(['verify', w('f.json', '[{"seq":0,"prev":"a","hash":"b","v":1e999}]')]).status, 3);
  assert.equal(cli(['verify', w('u.json', '[{"seq":0,"prev":"a","hash":"b","v":"\\ud800"}]')]).status, 3);
  assert.equal(cli(['verify', w('bad8.json', '[]').replace('bad8', 'x')]).status, 3);
});

test('REQ-IF-001: REGEN.json shape', async () => {
  const j = JSON.parse((await import('node:fs')).readFileSync(join(here, 'REGEN.json'), 'utf8'));
  for (const k of ['lang', 'build', 'test', 'driver', 'cli']) assert.ok(k in j);
  assert.equal(j.lang, 'ts');
  for (const k of ['test', 'driver', 'cli']) assert.ok(typeof j[k] === 'string' || 'default' in j[k]);
});

test('REQ-BU-001/002: budget and imports', async () => {
  const fs = await import('node:fs');
  let n = 0;
  for (const f of fs.readdirSync(here)) {
    if (!f.endsWith('.ts') || f.includes('.test.')) continue;
    const t = fs.readFileSync(join(here, f), 'utf8');
    n += t.split('\n').filter((l) => l.trim()).length;
    for (const m of t.matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('./') || m[1].startsWith('node:'), m[1]);
  }
  assert.ok(n <= 500, `lines: ${n}`);
});
