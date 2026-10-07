// Suite cases. Expected values come from oracle.mjs (checked against SPEC.md examples at load and
// against the earlier implementation in r00) or from the protocol's published fixtures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as O from './oracle.mjs';

const FX = join(import.meta.dirname, 'fixtures');
const read = (p) => JSON.parse(readFileSync(join(FX, p), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
export const ROVER = read('envelope/rover.valid.json');
export const ARM = read('envelope/tabletop-arm.valid.json');
export const FAIL_OPEN = read('envelope/fail-open-heartbeat.invalid.json');
export const L3 = read('envelope/protocol-level-as-assurance.invalid.json');
export const CHAIN = read('gate-decision/rover-chain.valid.json');
const CANON = read('canonical-json-v1.json');
const H_ROVER = O.envelopeHash(ROVER);

// A request line is JSON text. Most are built from objects; a few cases need exact text
// (numbers like 1e400 or -0, escapes like \ud800, member order), so `text` overrides.
// sub() is a replace that fails loudly when the text to replace is absent.
const sub = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`cases.mjs: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};
function expectOf(op, input) {
  try { return { kind: 'result', op, value: O.runOp(op, input) }; } catch (e) {
    if (e instanceof O.SpecError) return { kind: 'error', category: e.category };
    throw e;
  }
}

export function buildCases() {
  const cases = [];
  const ids = new Set();
  const add = (c) => { if (ids.has(c.id)) throw new Error(`dup ${c.id}`); ids.add(c.id); cases.push(c); };

  // driver case: op + input object (or exact JSON text for the whole line). The expected value
  // is computed from the line as sent, parsed back, so it sees exactly what the driver sees.
  const drv = (id, reqs, op, input, { text, na, expect } = {}) => {
    const lineText = text ?? JSON.stringify({ id, op, input });
    const e = expect ?? expectOf(op, JSON.parse(lineText).input);
    const check = e.kind === 'error' ? { kind: 'error', op, id, category: e.category } : { kind: 'result', op, value: e.value };
    add({ id, reqs, batch: 'main', line: lineText, check, na });
  };

  // ------------------------------------------------------------ interface (static + protocol)
  add({ id: 'if-regen', reqs: ['REQ-IF-001'], check: { kind: 'static', test: 'regen' } });
  add({ id: 'if-runtime', reqs: ['REQ-IF-001', 'REQ-BU-002'], check: { kind: 'static', test: 'runtime' }, na: ['reference'] });
  add({ id: 'bu-loc', reqs: ['REQ-BU-001'], check: { kind: 'static', test: 'loc' }, na: ['reference'] });
  add({ id: 'bu-deps', reqs: ['REQ-BU-002'], check: { kind: 'static', test: 'deps' }, na: ['reference'] });
  add({ id: 'if-utf8', reqs: ['REQ-IF-003'], batch: 'main', check: { kind: 'stdout', test: 'utf8' } });
  add({ id: 'if-lf', reqs: ['REQ-IF-003'], batch: 'main', check: { kind: 'stdout', test: 'lf' } });
  add({ id: 'if-count', reqs: ['REQ-IF-002', 'REQ-IF-005'], batch: 'main', check: { kind: 'stdout', test: 'count' } });
  add({ id: 'if-exit0', reqs: ['REQ-IF-002'], batch: 'main', check: { kind: 'stdout', test: 'exit0' } });
  add({ id: 'if-blank', reqs: ['REQ-IF-002'], batch: 'blank', lines: ['', JSON.stringify({ id: 'blank-1', op: 'canonical', input: { value: 1 } }), ' \t\r', JSON.stringify({ id: 'blank-2', op: 'canonical', input: { value: 2 } }), '\r', ''], check: { kind: 'stdout', test: 'blank' } });
  add({ id: 'if-continue', reqs: ['REQ-IF-007'], batch: 'continue', lines: ['not json', JSON.stringify({ id: 'after', op: 'canonical', input: { value: [1] } })], check: { kind: 'stdout', test: 'continue' } });

  // request errors (REQ-IF-007 order)
  const errLine = (id, reqs, text, category, idOut = id) => add({ id, reqs, batch: 'main', line: text, check: { kind: 'error', id: idOut, category } });
  errLine('err-not-json', ['REQ-IF-007'], '{"id":"x", nope', 'bad_request', null);
  errLine('err-array-line', ['REQ-IF-007'], '["canonical"]', 'bad_request', null);
  errLine('err-no-id', ['REQ-IF-007'], '{"op":"canonical","input":{"value":1}}', 'bad_request', null);
  errLine('err-id-number', ['REQ-IF-007'], '{"id":7,"op":"canonical","input":{"value":1}}', 'bad_request', null);
  errLine('err-unknown-op', ['REQ-IF-007'], '{"id":"err-unknown-op","op":"verify","input":{}}', 'unknown_op');
  errLine('err-no-op', ['REQ-IF-007'], '{"id":"err-no-op","input":{"value":1}}', 'unknown_op');
  errLine('err-op-number', ['REQ-IF-007'], '{"id":"err-op-number","op":3,"input":{}}', 'unknown_op');
  errLine('err-unknown-op-before-input', ['REQ-IF-007'], '{"id":"err-unknown-op-before-input","op":"hash"}', 'unknown_op');
  errLine('err-no-input', ['REQ-IF-007'], '{"id":"err-no-input","op":"canonical"}', 'bad_request');
  errLine('err-input-array', ['REQ-IF-007'], '{"id":"err-input-array","op":"canonical","input":[1]}', 'bad_request');
  errLine('err-input-null', ['REQ-IF-007'], '{"id":"err-input-null","op":"replay","input":null}', 'bad_request');
  errLine('err-nan-literal', ['REQ-IF-006', 'REQ-IF-007'], '{"id":"err-nan-literal","op":"canonical","input":{"value":NaN}}', 'bad_request', null);
  errLine('err-infinity-literal', ['REQ-IF-006', 'REQ-IF-007'], '{"id":"err-infinity-literal","op":"canonical","input":{"value":[-Infinity]}}', 'bad_request', null);
  drv('err-canonical-no-value', ['REQ-IF-007'], 'canonical', {});
  drv('err-envhash-array', ['REQ-IF-007'], 'envelopeHash', { envelope: [1] });
  drv('err-envhash-missing', ['REQ-IF-007'], 'envelopeHash', {});
  drv('err-rechash-string', ['REQ-IF-007'], 'recordHash', { record: 'x' });
  drv('err-verify-not-array', ['REQ-IF-007', 'REQ-CH-001'], 'verifyChain', { records: {} });
  drv('err-verify-head-number', ['REQ-IF-007'], 'verifyChain', { records: [], expectedHead: 5 });
  drv('err-audit-no-envelope', ['REQ-IF-007'], 'auditAuthority', { records: [] });
  drv('err-audit-envelope-array', ['REQ-IF-007'], 'auditAuthority', { records: [], envelope: [] });
  drv('err-replay-no-records', ['REQ-IF-007'], 'replay', { envelope: ROVER });
  drv('if-extra-members', ['REQ-IF-004'], 'canonical', null, { text: '{"id":"if-extra-members","op":"canonical","input":{"value":{"b":1,"a":2},"extra":true},"note":"ignored"}' });
  drv('if-id-unicode', ['REQ-IF-005'], 'canonical', null, { text: '{"id":"id-☕-\\u00e9","op":"canonical","input":{"value":"x"}}', expect: { kind: 'result', value: O.canonicalBytes('x').toString('base64') } });
  cases[cases.length - 1].check.idOverride = 'id-☕-é';
  drv('if-cr-inside-line', ['REQ-IF-002'], 'canonical', null, { text: '{"id":"if-cr-inside-line",\r"op":"canonical","input":{"value":[1,\r2]}}' });
  drv('if-crlf-line', ['REQ-IF-002'], 'canonical', null, { text: '{"id":"if-crlf-line","op":"canonical","input":{"value":"crlf"}}\r' });

  // record shape (REQ-CH-001)
  const recs = clone(CHAIN);
  const withRec = (i, patch) => { const r = clone(CHAIN); r[i] = { ...r[i], ...patch }; return r; };
  const drop = (i, k) => { const r = clone(CHAIN); delete r[i][k]; return r; };
  drv('shape-seq-negative', ['REQ-CH-001'], 'verifyChain', { records: withRec(2, { seq: -1 }) });
  drv('shape-seq-fraction', ['REQ-CH-001'], 'verifyChain', { records: withRec(2, { seq: 2.5 }) });
  drv('shape-seq-string', ['REQ-CH-001'], 'verifyChain', { records: withRec(2, { seq: '2' }) });
  drv('shape-seq-bool', ['REQ-CH-001'], 'verifyChain', { records: withRec(0, { seq: true }) });
  drv('shape-seq-infinite', ['REQ-CH-001', 'REQ-IF-006'], 'verifyChain', null, { text: sub(JSON.stringify({ id: 'shape-seq-infinite', op: 'verifyChain', input: { records: CHAIN } }), '"seq":5,', '"seq":1e400,') });
  drv('shape-seq-missing', ['REQ-CH-001'], 'verifyChain', { records: drop(2, 'seq') });
  drv('shape-prev-missing', ['REQ-CH-001'], 'verifyChain', { records: drop(3, 'prev') });
  drv('shape-hash-number', ['REQ-CH-001'], 'verifyChain', { records: withRec(1, { hash: 1 }) });
  drv('shape-record-not-object', ['REQ-CH-001'], 'verifyChain', { records: [recs[0], 'x'] });
  drv('shape-audit-seq-missing', ['REQ-CH-001'], 'auditAuthority', { records: drop(0, 'seq'), envelope: ROVER });
  drv('shape-replay-record-array', ['REQ-CH-001'], 'replay', { records: [[1]], envelope: ROVER });
  drv('shape-audit-no-links-needed', ['REQ-CH-001'], 'auditAuthority', { records: [{ seq: 0, decision: 'allow', principal: 'p', authority: 'a', cmd: { kind: 'motion' } }], envelope: ROVER });
  drv('shape-seq-float-integer', ['REQ-CH-001', 'REQ-IF-006'], 'verifyChain', null, { text: sub(sub(JSON.stringify({ id: 'shape-seq-float-integer', op: 'verifyChain', input: { records: CHAIN } }), '"seq":0,', '"seq":0.0,'), '"seq":1,', '"seq":1e0,') });

  // ------------------------------------------------------------ canonical (§ 2)
  for (const c of CANON.cases) {
    add({ id: `cj-fx-${c.name}`, reqs: ['REQ-CJ-001', 'REQ-CJ-003', 'REQ-CJ-006'], batch: 'main', line: JSON.stringify({ id: `cj-fx-${c.name}`, op: 'canonical', input: { value: c.input } }), check: { kind: 'result', op: 'canonical', value: c.expected_bytes_base64 } });
  }
  const cj = (id, reqs, valueText) => drv(id, reqs, 'canonical', null, { text: `{"id":"${id}","op":"canonical","input":{"value":${valueText}}}` });
  // structure
  cj('cj-utf16-order', ['REQ-CJ-001'], '{"\\ue000":1,"\\ud83d\\ude00":2}');
  cj('cj-utf16-order-nested', ['REQ-CJ-001'], '{"z":{"\\uffff":0,"\\ud800\\udc00":1,"a":2},"a":[{"b":1,"a":2}]}');
  cj('cj-sort-digits', ['REQ-CJ-001'], '{"10":1,"9":2,"b":3,"B":4,"_":5,"":6}');
  cj('cj-sort-prefix', ['REQ-CJ-001'], '{"ab":1,"a":2,"abc":3,"a\\u0000":4}');
  cj('cj-array-order', ['REQ-CJ-001'], '[3,1,2,{"b":[2,1],"a":null}]');
  cj('cj-literals', ['REQ-CJ-001'], '[true,false,null,{},[]]');
  cj('cj-whitespace', ['REQ-CJ-001'], ' { "a" : [ 1 , 2 ] , "b" : { } } ');
  cj('cj-top-number', ['REQ-CJ-001', 'REQ-CJ-003'], '42');
  cj('cj-top-string', ['REQ-CJ-001', 'REQ-CJ-002'], '"x"');
  cj('cj-top-null', ['REQ-CJ-001'], 'null');
  cj('cj-deep', ['REQ-CJ-001'], '{"a":{"b":{"c":{"d":{"e":[[[[{"z":1,"y":2}]]]]}}}}}');
  // strings
  for (let c = 0; c < 0x20; c++) cj(`cj-ctl-${c.toString(16).padStart(2, '0')}`, ['REQ-CJ-002'], `"a\\u${c.toString(16).padStart(4, '0')}b"`);
  cj('cj-quote-backslash', ['REQ-CJ-002'], '"q\\"b\\\\"');
  cj('cj-slash-raw', ['REQ-CJ-002'], '"a\\/b/c"');
  cj('cj-del-raw', ['REQ-CJ-002'], '"\\u007f"');
  cj('cj-ls-ps-raw', ['REQ-CJ-002'], '"\\u2028\\u2029"');
  cj('cj-nonbmp-raw', ['REQ-CJ-002'], '"\\ud83d\\ude00 \\ud834\\udd1e"');
  cj('cj-latin-raw', ['REQ-CJ-002'], '"Caf\\u00e9 \\u2615 \\u00a0"');
  cj('cj-key-escapes', ['REQ-CJ-002'], '{"a\\nb":1,"\\"":2,"\\u0001":3}');
  // numbers
  const nums = ['0', '-0', '-0.0', '1', '-1', '0.5', '-0.5', '1e21', '1e20', '999999999999999900000', '1.7976931348623157e308',
    '5e-324', '1e-6', '0.000001', '1e-7', '2.5e-7', '123.456', '0.3333333333333333', '0.30000000000000004', '9007199254740993',
    '-9007199254740993', '1e16', '12345678901234567890', '4.35', '0.000123', '1e300', '-1e-300', '100', '1E2', '1.0e+2', '0.1e1',
    '123456789012345680000', '1.5e-10', '-1.5e21', '2e-6', '9.999999999999999e20'];
  nums.forEach((t, i) => cj(`cj-num-${String(i).padStart(2, '0')}`, ['REQ-CJ-003'], `[${t}]`));
  cj('cj-num-in-object', ['REQ-CJ-003'], '{"a":1e21,"b":[0.000001,1e-7],"c":-0.0}');
  // non-finite and unpaired surrogates
  cj('cj-overflow', ['REQ-CJ-004'], '1e400');
  cj('cj-overflow-neg-nested', ['REQ-CJ-004'], '{"a":[1,-1e400]}');
  cj('cj-overflow-key-order', ['REQ-CJ-004'], '{"z":1e999,"a":1}');
  cj('cj-lone-high', ['REQ-CJ-005'], '"\\ud800"');
  cj('cj-lone-low', ['REQ-CJ-005'], '"x\\udc00y"');
  cj('cj-reversed-pair', ['REQ-CJ-005'], '"\\ude00\\ud83d"');
  cj('cj-lone-in-key', ['REQ-CJ-005'], '{"\\udbff":1}');
  cj('cj-lone-nested', ['REQ-CJ-005'], '[{"a":["ok","\\ud83d"]}]');
  // base64
  cj('cj-b64-long', ['REQ-CJ-006'], JSON.stringify({ k: 'x'.repeat(500), n: [1, 2, 3] }));
  cj('cj-b64-pad1', ['REQ-CJ-006'], '"ab"');
  cj('cj-b64-pad2', ['REQ-CJ-006'], '"abc"');

  // ------------------------------------------------------------ hashes (§ 3)
  drv('ha-rover', ['REQ-HA-001', 'REQ-HA-002'], 'envelopeHash', { envelope: ROVER }, { expect: { kind: 'result', value: CHAIN[0].envelope } });
  drv('ha-arm', ['REQ-HA-001', 'REQ-HA-002'], 'envelopeHash', { envelope: ARM });
  drv('ha-no-signature', ['REQ-HA-002'], 'envelopeHash', { envelope: { a: 1 } }, { expect: { kind: 'result', value: 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862' } });
  drv('ha-signature-removed', ['REQ-HA-002'], 'envelopeHash', { envelope: { signature: 'x', a: 1 } }, { expect: { kind: 'result', value: 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862' } });
  drv('ha-signature-nonfinite-ignored', ['REQ-HA-002', 'REQ-IF-007'], 'envelopeHash', null, { text: '{"id":"ha-signature-nonfinite-ignored","op":"envelopeHash","input":{"envelope":{"signature":1e400,"a":1}}}' });
  drv('ha-nested-signature-kept', ['REQ-HA-002'], 'envelopeHash', { envelope: { a: { signature: 'x' }, signature: 'y' } });
  drv('ha-envelope-overflow', ['REQ-HA-002', 'REQ-CJ-004'], 'envelopeHash', null, { text: '{"id":"ha-envelope-overflow","op":"envelopeHash","input":{"envelope":{"m":1e400}}}' });
  CHAIN.forEach((r, i) => drv(`ha-record-${i}`, ['REQ-HA-001', 'REQ-HA-003'], 'recordHash', { record: r }, { expect: { kind: 'result', value: r.hash } }));
  drv('ha-record-no-hash', ['REQ-HA-003'], 'recordHash', { record: { a: 1 } }, { expect: { kind: 'result', value: 'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862' } });
  drv('ha-record-nested-hash-kept', ['REQ-HA-003'], 'recordHash', { record: { hash: 'h', x: { hash: 'kept' } } });
  drv('ha-record-lone', ['REQ-HA-003', 'REQ-CJ-005'], 'recordHash', null, { text: '{"id":"ha-record-lone","op":"recordHash","input":{"record":{"a":"\\udfff"}}}' });

  // ------------------------------------------------------------ envelope validation (§ 4)
  const ev = (id, reqs, env, opts) => drv(id, reqs, 'validateEnvelope', { envelope: env }, opts);
  const mut = (f) => { const e = clone(ROVER); f(e); return e; };
  const mutArm = (f) => { const e = clone(ARM); f(e); return e; };
  ev('ev-fx-rover', ['REQ-EV-001', 'REQ-EV-004'], ROVER);
  ev('ev-fx-arm', ['REQ-EV-001', 'REQ-EV-004'], ARM);
  ev('ev-fx-fail-open', ['REQ-EV-001', 'REQ-EV-004'], FAIL_OPEN);
  ev('ev-fx-l3', ['REQ-EV-001', 'REQ-EV-004'], L3);
  for (const [n, v] of [['array', [1]], ['string', 'x'], ['null', null], ['number', 5], ['bool', true]]) ev(`ev-root-${n}`, ['REQ-EV-001', 'REQ-EV-002'], v);
  for (const k of ['envelope_version', 'machine', 'level', 'workspace', 'motion', 'stop', 'heartbeat']) ev(`ev-req-${k}`, ['REQ-EV-002', 'REQ-EV-004'], mut((e) => delete e[k]));
  ev('ev-req-machine-id', ['REQ-EV-002'], mut((e) => delete e.machine.id));
  ev('ev-req-machine-class', ['REQ-EV-002'], mut((e) => delete e.machine.class));
  ev('ev-req-frame', ['REQ-EV-002'], mut((e) => delete e.workspace.frame));
  ev('ev-req-keep-in', ['REQ-EV-002'], mut((e) => delete e.workspace.keep_in));
  ev('ev-req-max-speed', ['REQ-EV-002'], mut((e) => delete e.motion.max_speed_mps));
  for (const k of ['category', 'max_time_ms', 'max_distance_m']) ev(`ev-req-stop-${k}`, ['REQ-EV-002'], mut((e) => delete e.stop[k]));
  for (const k of ['model_timeout_ms', 'gate_timeout_ms', 'on_loss']) ev(`ev-req-hb-${k}`, ['REQ-EV-002'], mut((e) => delete e.heartbeat[k]));
  ev('ev-req-when', ['REQ-EV-002', 'REQ-EV-006'], mut((e) => delete e.proximity[0].when));
  ev('ev-req-human-within', ['REQ-EV-002', 'REQ-EV-006'], mut((e) => delete e.proximity[0].when.human_within_m));
  ev('ev-optional-absent', ['REQ-EV-004'], mut((e) => { delete e.proximity; delete e.sensing; delete e.authority; delete e.signature; delete e.machine.mass_kg; delete e.motion.max_turn_radps; delete e.motion.max_accel_mps2; delete e.workspace.keep_out; }));
  // unknown members: every object is closed
  ev('ev-unknown-root', ['REQ-EV-002'], mut((e) => { e.notes = 'x'; }));
  ev('ev-unknown-misspelled-limit', ['REQ-EV-002'], mut((e) => { e.motion.max_sped_mps = 5; }));
  for (const [path, f] of [['machine', (e) => { e.machine.serial = 'x'; }], ['workspace', (e) => { e.workspace.z = 1; }], ['force', (e) => { e.force = { max_contact_force_n: 1, extra: 1 }; }],
    ['sensing', (e) => { e.sensing.rate_hz = 10; }], ['stop', (e) => { e.stop.mode = 'x'; }], ['heartbeat', (e) => { e.heartbeat.on_recover = 'resume'; }],
    ['authority', (e) => { e.authority.scope = 'x'; }], ['proximity-rule', (e) => { e.proximity[0].note = 'x'; }], ['when', (e) => { e.proximity[0].when.robot_within_m = 1; }]])
    ev(`ev-unknown-${path}`, ['REQ-EV-002'], mut(f));
  ev('ev-unknown-pointer-escape', ['REQ-EV-001', 'REQ-EV-002'], mut((e) => { e['a/b~c'] = 1; }));
  // Member names that are also names of a language's built-in object members are still just names.
  ev('ev-unknown-inherited-names', ['REQ-EV-002'], null, { text: sub(JSON.stringify({ id: 'ev-unknown-inherited-names', op: 'validateEnvelope', input: { envelope: ROVER } }), '"envelope":{"envelope_version"', '"envelope":{"constructor":1,"toString":2,"__proto__":3,"envelope_version"') });
  ev('ev-unknown-inherited-nested', ['REQ-EV-002'], null, { text: sub(JSON.stringify({ id: 'ev-unknown-inherited-nested', op: 'validateEnvelope', input: { envelope: ROVER } }), '"machine":{', '"machine":{"hasOwnProperty":1,') });
  // types
  const typeMuts = [
    ['version-number', (e) => { e.envelope_version = 0.1; }], ['machine-string', (e) => { e.machine = 'rover'; }], ['machine-array', (e) => { e.machine = []; }],
    ['id-number', (e) => { e.machine.id = 1; }], ['mass-string', (e) => { e.machine.mass_kg = '2'; }], ['mass-bool', (e) => { e.machine.mass_kg = true; }],
    ['level-number', (e) => { e.level = 2; }], ['workspace-null', (e) => { e.workspace = null; }], ['frame-null', (e) => { e.workspace.frame = null; }],
    ['keep-in-object', (e) => { e.workspace.keep_in = {}; }], ['keep-out-object', (e) => { e.workspace.keep_out = {}; }],
    ['speed-string', (e) => { e.motion.max_speed_mps = '0.5'; }], ['speed-bool', (e) => { e.motion.max_speed_mps = true; }], ['turn-null', (e) => { e.motion.max_turn_radps = null; }],
    ['proximity-object', (e) => { e.proximity = {}; }], ['proximity-rule-array', (e) => { e.proximity[0] = []; }], ['when-number', (e) => { e.proximity[0].when = 1; }],
    ['state-age-fraction', (e) => { e.sensing.max_state_age_ms = 100.5; }], ['state-age-string', (e) => { e.sensing.max_state_age_ms = '100'; }],
    ['category-fraction', (e) => { e.stop.category = 1.5; }], ['category-string', (e) => { e.stop.category = '1'; }], ['time-fraction', (e) => { e.stop.max_time_ms = 300.25; }],
    ['distance-string', (e) => { e.stop.max_distance_m = '0.15'; }], ['model-timeout-fraction', (e) => { e.heartbeat.model_timeout_ms = 200.5; }],
    ['on-loss-bool', (e) => { e.heartbeat.on_loss = true; }], ['required-for-string', (e) => { e.authority.required_for = 'motion'; }],
    ['resolver-number', (e) => { e.authority.resolver = 1; }], ['signature-number', (e) => { e.signature = 7; }], ['authority-array', (e) => { e.authority = []; }],
  ];
  for (const [n, f] of typeMuts) ev(`ev-type-${n}`, ['REQ-EV-002', 'REQ-EV-003'], mut(f));
  ev('ev-type-overflow', ['REQ-EV-003', 'REQ-IF-006'], null, { text: sub(JSON.stringify({ id: 'ev-type-overflow', op: 'validateEnvelope', input: { envelope: ROVER } }), '"max_speed_mps":0.5', '"max_speed_mps":1e400') });
  ev('ev-int-as-float-ok', ['REQ-EV-003'], null, { text: sub(sub(sub(JSON.stringify({ id: 'ev-int-as-float-ok', op: 'validateEnvelope', input: { envelope: ROVER } }), '"max_time_ms":300', '"max_time_ms":300.0'), '"category":1', '"category":1.0'), '"model_timeout_ms":200', '"model_timeout_ms":2e2') });
  // values
  const valMuts = [
    ['version-1.0', (e) => { e.envelope_version = '1.0'; }], ['version-trailing-nl', (e) => { e.envelope_version = '0.1\n'; }], ['version-no-digits', (e) => { e.envelope_version = '0.'; }],
    ['version-letters', (e) => { e.envelope_version = '0.1a'; }], ['version-leading-space', (e) => { e.envelope_version = ' 0.1'; }], ['version-fullwidth-digit', (e) => { e.envelope_version = '0.１'; }],
    ['id-empty', (e) => { e.machine.id = ''; }], ['class-empty', (e) => { e.machine.class = ''; }], ['mass-zero', (e) => { e.machine.mass_kg = 0; }], ['mass-negative', (e) => { e.machine.mass_kg = -1; }],
    ['level-a4', (e) => { e.level = 'A4'; }], ['level-lower', (e) => { e.level = 'a1'; }], ['level-l3', (e) => { e.level = 'L3'; }], ['frame-empty', (e) => { e.workspace.frame = ''; }],
    ['speed-zero', (e) => { e.motion.max_speed_mps = 0; }], ['speed-negative', (e) => { e.motion.max_speed_mps = -0.5; }], ['turn-zero', (e) => { e.motion.max_turn_radps = 0; }],
    ['accel-negative', (e) => { e.motion.max_accel_mps2 = -1; }], ['joint-zero', (e) => { e.motion.max_joint_speed_radps = 0; }],
    ['state-age-zero', (e) => { e.sensing.max_state_age_ms = 0; }], ['category-3', (e) => { e.stop.category = 3; }], ['category-negative', (e) => { e.stop.category = -1; }],
    ['time-zero', (e) => { e.stop.max_time_ms = 0; }], ['distance-negative', (e) => { e.stop.max_distance_m = -0.01; }], ['gate-timeout-zero', (e) => { e.heartbeat.gate_timeout_ms = 0; }],
    ['on-loss-continue', (e) => { e.heartbeat.on_loss = 'continue'; }], ['on-loss-case', (e) => { e.heartbeat.on_loss = 'Stop'; }], ['resolver-remote', (e) => { e.authority.resolver = 'remote'; }],
    ['sig-upper', (e) => { e.signature = 'ED25519:abc'; }], ['sig-empty-value', (e) => { e.signature = 'ed25519:'; }], ['sig-no-alg', (e) => { e.signature = ':abc'; }],
    ['sig-no-colon', (e) => { e.signature = 'ed25519abc'; }], ['sig-newline', (e) => { e.signature = 'ed25519:ab\ncd'; }], ['sig-trailing-newline', (e) => { e.signature = 'ed25519:abcd\n'; }],
    ['sig-cr', (e) => { e.signature = 'ed25519:ab\rcd'; }], ['sig-ls', (e) => { e.signature = 'ed25519:ab cd'; }], ['sig-ps', (e) => { e.signature = 'ed25519:ab '; }],
    ['sig-underscore-alg', (e) => { e.signature = 'ed_25519:abc'; }],
  ];
  for (const [n, f] of valMuts) ev(`ev-val-${n}`, ['REQ-EV-004'], mut(f));
  const okMuts = [
    ['version-0.10', (e) => { e.envelope_version = '0.10'; }], ['payload-zero', (e) => { e.force = { max_payload_kg: 0 }; }], ['distance-zero', (e) => { e.stop.max_distance_m = 0; }],
    ['category-0', (e) => { e.stop.category = 0; }], ['category-2', (e) => { e.stop.category = 2; }], ['resolver-local', (e) => { e.authority.resolver = 'local'; }],
    ['sig-space-tab', (e) => { e.signature = 'hybrid-ed25519-mldsa65:a b\tc'; }], ['sig-colons', (e) => { e.signature = 'x:y:z'; }], ['speed-tiny', (e) => { e.motion.max_speed_mps = 5e-324; }],
    ['prox-speed-zero', (e) => { e.proximity[0].max_speed_mps = 0; }], ['level-a3', (e) => { e.level = 'A3'; }],
  ];
  for (const [n, f] of okMuts) ev(`ev-ok-${n}`, ['REQ-EV-004'], mut(f));
  // points, pairs, polygons
  ev('ev-poly-two-points', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in = [[0, 0], [1, 1]]; }));
  ev('ev-poly-empty', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in = []; }));
  ev('ev-point-three', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in[1] = [6, 0, 1]; }));
  ev('ev-point-one', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in[1] = [6]; }));
  ev('ev-point-string', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in[2] = ['6', 4]; }));
  ev('ev-point-three-bad-first', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in[2] = ['a', 1, 2]; }));
  ev('ev-point-object', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in[0] = { x: 0, y: 0 }; }));
  ev('ev-point-null-coord', ['REQ-EV-005'], mut((e) => { e.workspace.keep_in[0] = [null, 0]; }));
  ev('ev-keep-out-small', ['REQ-EV-005'], mutArm((e) => { e.workspace.keep_out.push([[0, 0], [1, 1]]); }));
  ev('ev-keep-out-bad-point', ['REQ-EV-005'], mutArm((e) => { e.workspace.keep_out[0][3] = [0]; }));
  ev('ev-z-one', ['REQ-EV-005'], mutArm((e) => { e.workspace.z_range_m = [0.1]; }));
  ev('ev-z-three', ['REQ-EV-005'], mutArm((e) => { e.workspace.z_range_m = [0, 0.1, 0.2]; }));
  ev('ev-z-reversed-ok', ['REQ-EV-005'], mutArm((e) => { e.workspace.z_range_m = [0.3, 0.01]; }));
  ev('ev-z-string', ['REQ-EV-005'], mutArm((e) => { e.workspace.z_range_m = [0, '1']; }));
  ev('ev-poly-many-errors', ['REQ-EV-005', 'REQ-EV-002'], mut((e) => { e.workspace.keep_in = [[0], ['x', 1]]; }));
  // proximity rules
  ev('ev-prox-both', ['REQ-EV-006'], mut((e) => { e.proximity[1].max_speed_mps = 0.1; }));
  ev('ev-prox-neither', ['REQ-EV-006'], mut((e) => { delete e.proximity[0].max_speed_mps; }));
  ev('ev-prox-action-slow', ['REQ-EV-006'], mut((e) => { e.proximity[1].action = 'slow'; }));
  ev('ev-prox-speed-negative', ['REQ-EV-006'], mut((e) => { e.proximity[0].max_speed_mps = -0.1; }));
  ev('ev-prox-within-zero', ['REQ-EV-006'], mut((e) => { e.proximity[0].when.human_within_m = 0; }));
  ev('ev-prox-neither-and-unknown', ['REQ-EV-006', 'REQ-EV-002'], mut((e) => { e.proximity[0] = { when: { human_within_m: 1 }, speed: 0.2 }; }));
  ev('ev-prox-empty-array-ok', ['REQ-EV-006'], mut((e) => { e.proximity = []; }));
  ev('ev-prox-action-wrong-type', ['REQ-EV-006'], mut((e) => { e.proximity[1].action = 5; }));
  ev('ev-prox-both-one-wrong-type', ['REQ-EV-006'], mut((e) => { e.proximity[0].action = 'stop'; e.proximity[0].max_speed_mps = 'fast'; }));
  // uniqueness
  ev('ev-unique-dup', ['REQ-EV-007'], mut((e) => { e.authority.required_for = ['motion', 'motion']; }));
  ev('ev-unique-triple', ['REQ-EV-007'], mut((e) => { e.authority.required_for = ['a', 'b', 'a', 'a', 'b']; }));
  ev('ev-unique-nonstring', ['REQ-EV-007'], mut((e) => { e.authority.required_for = ['motion', 1, 1]; }));
  ev('ev-unique-ok', ['REQ-EV-007'], mut((e) => { e.authority.required_for = ['motion', 'gripper', 'Motion']; }));
  // several errors at once
  ev('ev-many', ['REQ-EV-002', 'REQ-EV-004'], mut((e) => { e.level = 'L2'; e.motion.max_speed_mps = 0; delete e.stop; e.heartbeat.on_loss = 'continue'; e.extra = 1; e.machine.id = ''; }));

  // ------------------------------------------------------------ chain verification (§ 5)
  const vc = (id, reqs, records, expectedHead, opts) => drv(id, reqs, 'verifyChain', expectedHead === undefined ? { records } : { records, expectedHead }, opts);
  const head = CHAIN[CHAIN.length - 1].hash;
  const rehash = (r) => ({ ...r, hash: O.recordHash(r) });
  vc('ch-valid', ['REQ-CH-002', 'REQ-CH-003'], CHAIN);
  vc('ch-valid-anchored', ['REQ-CH-003'], CHAIN, head);
  vc('ch-truncated-unanchored', ['REQ-CH-004'], CHAIN.slice(0, 4));
  vc('ch-truncated-anchored', ['REQ-CH-003', 'REQ-CH-004'], CHAIN.slice(0, 4), head);
  vc('ch-empty', ['REQ-CH-003'], []);
  vc('ch-empty-anchored-genesis', ['REQ-CH-003'], [], O.GENESIS);
  vc('ch-empty-anchored-other', ['REQ-CH-003'], [], head);
  vc('ch-wrong-anchor-full', ['REQ-CH-003'], CHAIN, CHAIN[0].hash);
  vc('ch-mutate-field', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[2].reason = 'edited'; return c; })());
  vc('ch-mutate-applied', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[1].applied.linear_mps = 0.9; return c; })());
  vc('ch-mutate-and-rehash', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[2].reason = 'edited'; c[2] = rehash(c[2]); return c; })());
  vc('ch-delete-middle', ['REQ-CH-002'], CHAIN.filter((_, i) => i !== 2));
  vc('ch-delete-first', ['REQ-CH-002'], CHAIN.slice(1));
  vc('ch-insert-forged', ['REQ-CH-002'], (() => {
    const c = clone(CHAIN);
    const { reason: _reason, ...base } = c[1];
    const forged = rehash({ ...base, seq: 2, prev: c[1].hash, decision: 'allow', applied: c[1].cmd });
    return [...c.slice(0, 2), forged, ...c.slice(2)];
  })());
  vc('ch-reorder', ['REQ-CH-002'], [CHAIN[0], CHAIN[1], CHAIN[3], CHAIN[2], CHAIN[4], CHAIN[5]]);
  vc('ch-bad-genesis-seq', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[0].seq = 1; return c; })());
  vc('ch-bad-genesis-seq-rehashed', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[0] = rehash({ ...c[0], seq: 1 }); return c; })());
  vc('ch-genesis-prev-not-zero', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[0] = rehash({ ...c[0], prev: 'sha256:' + '1'.repeat(64) }); return c; })());
  vc('ch-hash-uppercase', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[5].hash = c[5].hash.toUpperCase().replace('SHA256', 'sha256'); return c; })());
  vc('ch-extra-member', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[3].note = 'added'; return c; })());
  vc('ch-seq-jump', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[4] = rehash({ ...c[4], seq: 10 }); c[5] = rehash({ ...c[5], seq: 11, prev: c[4].hash }); return c; })());
  vc('ch-single', ['REQ-CH-002', 'REQ-CH-003'], CHAIN.slice(0, 1), CHAIN[0].hash);
  vc('ch-prev-uses-written-hash', ['REQ-CH-002'], (() => { const c = clone(CHAIN); c[2].hash = 'sha256:' + 'a'.repeat(64); c[3] = rehash({ ...c[3], prev: c[2].hash }); return c; })());
  vc('ch-record-overflow', ['REQ-CH-002', 'REQ-CJ-004'], null, undefined, { text: sub(JSON.stringify({ id: 'ch-record-overflow', op: 'verifyChain', input: { records: CHAIN } }), '"linear_mps":0.9', '"linear_mps":9e999') });
  vc('ch-detail-ignored-shape', ['REQ-CH-005'], (() => { const c = clone(CHAIN); c[1].reason = 'x'; return c; })());

  // ------------------------------------------------------------ authority audit (§ 6)
  const aa = (id, reqs, records, envelope = ROVER) => drv(id, reqs, 'auditAuthority', { records, envelope });
  const one = (patch) => [{ seq: 0, decision: 'allow', principal: 'user:a', authority: 'jwt:1', cmd: { kind: 'motion' }, ...patch }];
  aa('aa-valid-chain', ['REQ-AA-001', 'REQ-AA-002'], CHAIN);
  aa('aa-no-authority-null', ['REQ-AA-002'], one({ authority: null }));
  aa('aa-no-authority-missing', ['REQ-AA-002'], (() => { const r = one({}); delete r[0].authority; return r; })());
  aa('aa-no-authority-empty', ['REQ-AA-002'], one({ authority: '' }));
  aa('aa-no-authority-number', ['REQ-AA-002'], one({ authority: 5 }));
  aa('aa-no-principal-empty', ['REQ-AA-002'], one({ principal: '' }));
  aa('aa-no-principal-zero', ['REQ-AA-002'], one({ principal: 0 }));
  aa('aa-both-missing', ['REQ-AA-002'], (() => { const r = one({ decision: 'clamp' }); delete r[0].principal; delete r[0].authority; return r; })());
  aa('aa-principal-true', ['REQ-AA-002'], one({ principal: true, authority: {} }));
  aa('aa-kind-not-gated', ['REQ-AA-001'], one({ cmd: { kind: 'speak' }, authority: null }));
  aa('aa-cmd-null-is-motion', ['REQ-AA-001'], one({ cmd: null, authority: null }));
  aa('aa-cmd-missing-is-motion', ['REQ-AA-001'], (() => { const r = one({ authority: null }); delete r[0].cmd; return r; })());
  aa('aa-kind-number-is-motion', ['REQ-AA-001'], one({ cmd: { kind: 7 }, authority: null }));
  aa('aa-cmd-array-is-motion', ['REQ-AA-001'], one({ cmd: [1], authority: null }));
  aa('aa-reject-not-audited', ['REQ-AA-001'], one({ decision: 'reject', authority: null, principal: '' }));
  aa('aa-stop-not-audited', ['REQ-AA-001'], one({ decision: 'stop', authority: null }));
  aa('aa-unknown-decision-not-audited', ['REQ-AA-001'], one({ decision: 'escalate', authority: null }));
  aa('aa-no-authority-block', ['REQ-AA-001'], one({ authority: null }), (() => { const e = clone(ROVER); delete e.authority; return e; })());
  aa('aa-required-for-string', ['REQ-AA-001'], one({ authority: null }), (() => { const e = clone(ROVER); e.authority.required_for = 'motion'; return e; })());
  aa('aa-required-for-mixed', ['REQ-AA-001'], one({ authority: null }), (() => { const e = clone(ROVER); e.authority.required_for = [5, 'motion']; return e; })());
  aa('aa-authority-not-object', ['REQ-AA-001'], one({ authority: null }), (() => { const e = clone(ROVER); e.authority = ['motion']; return e; })());
  aa('aa-gripper-arm', ['REQ-AA-001', 'REQ-AA-002'], [...one({ cmd: { kind: 'gripper' }, authority: null }), { seq: 1, decision: 'clamp', principal: '', authority: 'jwt:2', cmd: { kind: 'wave' } }, { seq: 2, decision: 'clamp', principal: '', authority: null, cmd: { kind: 'motion' } }], ARM);
  drv('aa-nonfinite-ignored', ['REQ-AA-001', 'REQ-IF-007'], 'auditAuthority', null, { text: sub(JSON.stringify({ id: 'aa-nonfinite-ignored', op: 'auditAuthority', input: { records: one({ authority: null, extra: 5 }), envelope: ROVER } }), '"extra":5', '"extra":1e400,"note":"\\ud800"') });

  // ------------------------------------------------------------ replay (§ 7)
  const rp = (id, reqs, records, envelope = ROVER, opts) => drv(id, reqs, 'replay', { records, envelope }, opts);
  const R = (patch) => ({ seq: 0, type: 'gate_decision', decision: 'allow', principal: 'user:a', authority: 'jwt:1', envelope: H_ROVER,
    cmd: { kind: 'motion', linear_mps: 0.2, angular_radps: 0.1, target: [2, 1] }, applied: { kind: 'motion', linear_mps: 0.2, angular_radps: 0.1, target: [2, 1] }, ...patch });
  const clampR = (applied, extra = {}) => R({ decision: 'clamp', reason: 'r', applied: { kind: 'motion', ...applied }, ...extra });
  rp('rp-valid-chain', ['REQ-RP-001', 'REQ-RP-005'], CHAIN);
  rp('rp-envelope-mismatch-arm', ['REQ-RP-001'], CHAIN, ARM);
  rp('rp-envelope-mismatch-fail-open', ['REQ-RP-001'], CHAIN, FAIL_OPEN);
  rp('rp-envelope-signature-ignored', ['REQ-RP-001', 'REQ-HA-002'], CHAIN, { ...ROVER, signature: 'ed25519:other' });
  rp('rp-speed-exceeded', ['REQ-RP-001', 'REQ-RP-002'], [clampR({ linear_mps: 0.6 })]);
  rp('rp-speed-negative', ['REQ-RP-001'], [clampR({ linear_mps: -0.51 })]);
  rp('rp-speed-at-limit', ['REQ-RP-001'], [clampR({ linear_mps: 0.5 })]);
  rp('rp-speed-string-unchecked-bound', ['REQ-RP-001'], [clampR({ linear_mps: '9' })]);
  rp('rp-turn-exceeded', ['REQ-RP-001'], [clampR({ angular_radps: 1.6 })]);
  rp('rp-turn-negative', ['REQ-RP-001'], [clampR({ angular_radps: -1.5000001 })]);
  rp('rp-no-turn-bound', ['REQ-RP-002'], [R({ decision: 'clamp', reason: 'r', envelope: O.envelopeHash(ARM), applied: { kind: 'motion', angular_radps: 99, linear_mps: 0.1, target: [0.2, 0] } })], ARM);
  rp('rp-bound-not-number', ['REQ-RP-002'], [clampR({ linear_mps: 3 })], (() => { const e = clone(ROVER); e.motion.max_speed_mps = '0.5'; return e; })());
  rp('rp-outside-keep-in', ['REQ-RP-001'], [clampR({ target: [7, 1] })]);
  rp('rp-keep-in-edge', ['REQ-RP-003'], [clampR({ target: [6, 2] }), clampR({ target: [3, 0] }, { seq: 1 }), clampR({ target: [0, 4] }, { seq: 2 })]);
  rp('rp-keep-in-just-outside', ['REQ-RP-003'], [clampR({ target: [6.5, 2] }), clampR({ target: [3, -0.5] }, { seq: 1 })]);
  rp('rp-keep-in-negative-zero', ['REQ-RP-003'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-keep-in-negative-zero', op: 'replay', input: { records: [clampR({ target: [0, 2] })], envelope: ROVER } }), '"target":[0,2]', '"target":[-0,2]') });
  const ZONES = (() => { const e = clone(ROVER); e.workspace.keep_out = [[[1, 1], [3, 1], [3, 3], [1, 3]], [[2, 2], [5, 2], [5, 3], [2, 3]], [[0, 0], [1, 0]]]; return e; })();
  const HZ = O.envelopeHash(ZONES);
  const Z = (target, seq = 0) => R({ seq, decision: 'clamp', reason: 'r', envelope: HZ, applied: { kind: 'motion', target } });
  rp('rp-keep-out-inside', ['REQ-RP-001', 'REQ-RP-003'], [Z([1.5, 1.5])], ZONES);
  rp('rp-keep-out-two-zones', ['REQ-RP-001'], [Z([2.5, 2.5])], ZONES);
  rp('rp-keep-out-edge', ['REQ-RP-003'], [Z([3, 1.5]), Z([1, 1], 1), Z([4, 3], 2)], ZONES);
  rp('rp-keep-out-clear', ['REQ-RP-003'], [Z([5.5, 0.5]), Z([0.5, 3.5], 1)], ZONES);
  rp('rp-keep-out-skips-non-polygon', ['REQ-RP-002'], [Z([0.5, 0])], ZONES);
  const BADZ = (() => { const e = clone(ROVER); e.workspace.keep_out = [[[0, 0], [2, 0], [2, 2], [0]]]; return e; })();
  rp('rp-keep-out-bad-element', ['REQ-RP-002'], [R({ decision: 'clamp', reason: 'r', envelope: O.envelopeHash(BADZ), applied: { kind: 'motion', target: [1, 1] } })], BADZ);
  const BADIN = (() => { const e = clone(ROVER); e.workspace.keep_in = [[0, 0], [6, 0], [6, 4], ['0', 4]]; return e; })();
  rp('rp-keep-in-bad-element', ['REQ-RP-002'], [R({ decision: 'clamp', reason: 'r', envelope: O.envelopeHash(BADIN), applied: { kind: 'motion', target: [9, 9] } })], BADIN);
  rp('rp-keep-in-not-polygon', ['REQ-RP-002'], [R({ decision: 'clamp', reason: 'r', envelope: '', applied: { kind: 'motion', target: [99, 99] } })], (() => { const e = clone(ROVER); e.workspace.keep_in = [[0, 0], [1, 1]]; return e; })());
  rp('rp-concave-keep-in', ['REQ-RP-003'], (() => { const pts = [[2, 1], [2, 3], [0.5, 2], [5.5, 2]]; return pts.map((t, i) => R({ seq: i, decision: 'clamp', reason: 'r', envelope: '', applied: { kind: 'motion', target: t } })); })(),
    (() => { const e = clone(ROVER); e.workspace.keep_in = [[0, 0], [6, 0], [6, 4], [3, 1], [0, 4]]; return e; })());
  rp('rp-target-not-point', ['REQ-RP-001'], [clampR({ target: [99] }), clampR({ target: ['99', 1] }, { seq: 1 }), clampR({ target: [99, 1, 0] }, { seq: 2 }), clampR({ target: { x: 99, y: 1 } }, { seq: 3 })]);
  rp('rp-stop-with-motion', ['REQ-RP-001'], [R({ decision: 'stop', reason: 'r', cmd: null, applied: { kind: 'stop', linear_mps: 0.1, angular_radps: 0 } })]);
  rp('rp-stop-with-turn', ['REQ-RP-001'], [R({ decision: 'stop', reason: 'r', cmd: null, applied: { kind: 'stop', angular_radps: -0.2 } })]);
  rp('rp-stop-both-motion', ['REQ-RP-001'], [R({ decision: 'stop', reason: 'r', cmd: null, applied: { kind: 'stop', linear_mps: 0.1, angular_radps: 0.2 } })]);
  rp('rp-speed-infinite', ['REQ-RP-001', 'REQ-RP-004', 'REQ-IF-007'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-speed-infinite', op: 'replay', input: { records: [clampR({ linear_mps: 7 })], envelope: ROVER } }), '"linear_mps":7', '"linear_mps":1e400') });
  rp('rp-lazy-reject-nonfinite', ['REQ-RP-001', 'REQ-IF-007'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-lazy-reject-nonfinite', op: 'replay', input: { records: [R({ decision: 'reject', reason: 'r', applied: null })], envelope: ROVER } }), '"linear_mps":0.2', '"linear_mps":1e400') });
  rp('rp-allow-nonfinite-error', ['REQ-RP-001', 'REQ-IF-007'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-allow-nonfinite-error', op: 'replay', input: { records: [R({ applied: { kind: 'motion', linear_mps: 0.3 } })], envelope: ROVER } }), '"linear_mps":0.3', '"linear_mps":1e400') });
  rp('rp-allow-not-object-lazy', ['REQ-RP-001', 'REQ-IF-007'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-allow-not-object-lazy', op: 'replay', input: { records: [R({ applied: null })], envelope: ROVER } }), '"linear_mps":0.2', '"linear_mps":1e400') });
  rp('rp-stop-still', ['REQ-RP-001'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-stop-still', op: 'replay', input: { records: [R({ decision: 'stop', reason: 'r', cmd: null, applied: { kind: 'stop', linear_mps: 0, angular_radps: 0.0 } }), R({ seq: 1, decision: 'stop', reason: 'r', cmd: null, applied: { kind: 'stop' } })], envelope: ROVER } }), '"linear_mps":0,', '"linear_mps":-0.0,') });
  rp('rp-stop-ignores-bounds', ['REQ-RP-001'], [R({ decision: 'stop', reason: 'r', applied: { kind: 'stop', linear_mps: 0, target: [99, 99] } })]);
  rp('rp-reject-applied-object', ['REQ-RP-001'], [R({ decision: 'reject', reason: 'r', applied: {} })]);
  rp('rp-reject-applied-missing', ['REQ-RP-001'], [(() => { const r = R({ decision: 'reject', reason: 'r' }); delete r.applied; return r; })()]);
  rp('rp-reject-ok', ['REQ-RP-001'], [R({ decision: 'reject', reason: 'r', applied: null })]);
  rp('rp-reject-ignores-bounds', ['REQ-RP-001'], [R({ decision: 'reject', reason: 'r', applied: { linear_mps: 99, gripper: 1 } })]);
  rp('rp-applied-not-object', ['REQ-RP-001'], [R({ applied: null }), R({ seq: 1, decision: 'stop', reason: 'r', applied: [] }), R({ seq: 2, decision: 'clamp', reason: 'r', applied: 'x' }), (() => { const r = R({ seq: 3, decision: 'clamp' }); delete r.applied; delete r.reason; return r; })()]);
  rp('rp-allow-modified', ['REQ-RP-001'], [R({ applied: { kind: 'motion', linear_mps: 0.1, angular_radps: 0.1, target: [2, 1] } })]);
  rp('rp-allow-same-different-order', ['REQ-RP-001'], [R({ applied: { target: [2, 1], angular_radps: 0.1, linear_mps: 0.2, kind: 'motion' } })]);
  rp('rp-allow-number-forms', ['REQ-RP-001', 'REQ-IF-006'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-allow-number-forms', op: 'replay', input: { records: [R({})], envelope: ROVER } }), '"applied":{"kind":"motion","linear_mps":0.2', '"applied":{"kind":"motion","linear_mps":2e-1') });
  rp('rp-allow-cmd-missing', ['REQ-RP-001'], [(() => { const r = R({}); delete r.cmd; return r; })()]);
  rp('rp-allow-extra-applied', ['REQ-RP-001', 'REQ-RP-004'], [R({ applied: { ...R({}).applied, gripper: 0.5 } })]);
  rp('rp-allow-bool-vs-number', ['REQ-RP-001', 'REQ-RP-004'], [R({ cmd: { ...R({}).cmd, lamp: true }, applied: { ...R({}).applied, lamp: 1 } })]);
  rp('rp-unchecked-wrong-type', ['REQ-RP-004'], [clampR({ linear_mps: '0.4', angular_radps: null, target: [1] }), R({ seq: 1, decision: 'stop', reason: 'r', cmd: null, applied: { kind: 'stop', linear_mps: 0, target: [1, 1] } })]);
  rp('rp-unchecked-utf16-order', ['REQ-RP-004'], [clampR({ '\ue000': 1, '\u{1F600}': 2, Z: 3, a: 4 })]);
  rp('rp-unchecked-inherited-names', ['REQ-RP-004'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-unchecked-inherited-names', op: 'replay', input: { records: [clampR({ zz: 1 })], envelope: ROVER } }), '"zz":1', '"constructor":1,"__proto__":2,"toString":3') });
  rp('rp-missing-reason', ['REQ-RP-001'], [clampR({}, { reason: undefined }), R({ seq: 1, decision: 'reject', applied: null, reason: '' }), R({ seq: 2, decision: 'stop', applied: { kind: 'stop' }, reason: 5 }), R({ seq: 3 })].map((r) => JSON.parse(JSON.stringify(r))));
  rp('rp-unknown-decision', ['REQ-RP-001'], [R({ decision: 'escalate', envelope: 'sha256:x', reason: undefined }), (() => { const r = R({ seq: 1 }); delete r.decision; return r; })(), R({ seq: 2, decision: 'ALLOW' })].map((r) => JSON.parse(JSON.stringify(r))));
  rp('rp-unchecked-fields', ['REQ-RP-004'], [clampR({ gripper: 1, z_m: 0.1 }), clampR({ z_m: 0.2, joint: [1, 2] }, { seq: 1 }), R({ seq: 2, decision: 'stop', reason: 'r', cmd: null, applied: { kind: 'stop', brake: true } })]);
  rp('rp-unchecked-not-from-reject-or-nonobject', ['REQ-RP-004'], [R({ decision: 'reject', reason: 'r', applied: { secret: 1 } }), R({ seq: 1, decision: 'clamp', reason: 'r', applied: ['x'] })]);
  rp('rp-order-in-record', ['REQ-RP-001'], [clampR({ linear_mps: 0.9, angular_radps: 2, target: [9, 9], extra: 1 }, { envelope: 'sha256:x', reason: '' })]);
  rp('rp-order-allow-full', ['REQ-RP-001'], [R({ envelope: 'sha256:y', applied: { kind: 'motion', linear_mps: -0.7, angular_radps: 1.7, target: [-1, -1] } })]);
  rp('rp-envelope-overflow', ['REQ-RP-001', 'REQ-CJ-004'], null, undefined, { text: sub(JSON.stringify({ id: 'rp-envelope-overflow', op: 'replay', input: { records: [], envelope: { m: 1 } } }), '"m":1', '"m":-1e999') });
  rp('rp-records-many', ['REQ-RP-001', 'REQ-RP-004'], [...CHAIN, clampR({ linear_mps: 0.55, wrist: 1 }, { seq: 6 }), R({ seq: 7, applied: { kind: 'motion', linear_mps: 0.2 } })]);

  // ------------------------------------------------------------ command line (§ 8)
  const tampered = (() => { const c = clone(CHAIN); c[2].reason = 'edited'; return c; })();
  const withExtra = (() => { const c = clone(CHAIN); c[0] = { ...c[0], applied: { ...c[0].applied, gripper: 1 }, cmd: { ...c[0].cmd, gripper: 1 } }; c[0] = rehash(c[0]); for (let i = 1; i < c.length; i++) { c[i] = rehash({ ...c[i], prev: c[i - 1].hash }); } return c; })();
  const cli = (id, reqs, args, files, { na, expect } = {}) => {
    const model = expect ?? (() => {
      const parse = (name) => { const t = files[name]; return t === undefined ? undefined : JSON.parse(t); };
      const fileArgs = args.filter((a, i) => a !== '--json' && a !== 'verify' && args[i - 1] !== '--head' && a !== '--head');
      const headIdx = args.indexOf('--head');
      return O.cliModel({ chain: parse(fileArgs[0]), envelope: fileArgs[1] === undefined ? undefined : parse(fileArgs[1]), head: headIdx >= 0 ? args[headIdx + 1] : undefined });
    })();
    add({ id, reqs, check: { kind: 'cli', args, files, exit: model.exit, report: args.includes('--json') && model.exit <= 1 ? model.report : undefined }, na });
  };
  const J = (v) => JSON.stringify(v, null, 2);
  const F = { 'chain.json': J(CHAIN), 'rover.json': J(ROVER) };
  cli('cl-ok-json', ['REQ-CL-001', 'REQ-CL-002', 'REQ-CL-003', 'REQ-CL-004'], ['verify', 'chain.json', 'rover.json', '--json'], F, { na: ['reference'] });
  cli('cl-ok-exit', ['REQ-CL-003'], ['verify', 'chain.json', 'rover.json'], F);
  cli('cl-chain-only-json', ['REQ-CL-002', 'REQ-CL-004'], ['verify', 'chain.json', '--json'], F, { na: ['reference'] });
  cli('cl-chain-only-exit', ['REQ-CL-003'], ['verify', 'chain.json'], F);
  cli('cl-json-first', ['REQ-CL-001'], ['verify', '--json', 'chain.json', 'rover.json'], F, { na: ['reference'] });
  cli('cl-head-ok', ['REQ-CL-001', 'REQ-CL-002'], ['verify', 'chain.json', '--head', CHAIN[5].hash, '--json'], F, { na: ['reference'] });
  cli('cl-head-between', ['REQ-CL-001'], ['verify', 'chain.json', '--head', CHAIN[5].hash, 'rover.json', '--json'], F, { na: ['reference'] });
  cli('cl-head-wrong', ['REQ-CL-002', 'REQ-CL-003'], ['verify', 'chain.json', '--json', '--head', CHAIN[3].hash], F, { na: ['reference'] });
  cli('cl-truncated-head', ['REQ-CL-002', 'REQ-CH-004'], ['verify', 'short.json', '--head', CHAIN[5].hash, '--json'], { 'short.json': J(CHAIN.slice(0, 3)) }, { na: ['reference'] });
  cli('cl-tampered-json', ['REQ-CL-003', 'REQ-CL-004'], ['verify', 't.json', 'rover.json', '--json'], { 't.json': J(tampered), 'rover.json': J(ROVER) }, { na: ['reference'] });
  cli('cl-tampered-exit', ['REQ-CL-003'], ['verify', 't.json', 'rover.json'], { 't.json': J(tampered), 'rover.json': J(ROVER) });
  cli('cl-invalid-envelope', ['REQ-CL-002', 'REQ-CL-003', 'REQ-CL-004'], ['verify', 'chain.json', 'fo.json', '--json'], { 'chain.json': J(CHAIN), 'fo.json': J(FAIL_OPEN) }, { na: ['reference'] });
  cli('cl-unchecked-only-ok', ['REQ-CL-003', 'REQ-RP-004'], ['verify', 'x.json', 'env.json', '--json'], { 'x.json': J(withExtra), 'env.json': J(ROVER) }, { na: ['reference'] });
  cli('cl-unchecked-only-exit', ['REQ-CL-003'], ['verify', 'x.json', 'env.json'], { 'x.json': J(withExtra), 'env.json': J(ROVER) });
  cli('cl-arm-mismatch', ['REQ-CL-002', 'REQ-CL-004'], ['verify', 'chain.json', 'arm.json', '--json'], { 'chain.json': J(CHAIN), 'arm.json': J(ARM) }, { na: ['reference'] });
  cli('cl-crlf-file', ['REQ-CL-002'], ['verify', 'crlf.json', '--json'], { 'crlf.json': J(CHAIN).replace(/\n/g, '\r\n') }, { na: ['reference'] });
  cli('cl-subdir-path', ['REQ-CL-001'], ['verify', 'sub/chain.json', '--json'], { 'sub/chain.json': J(CHAIN) }, { na: ['reference'] });
  const bigT = (() => { const c = clone(CHAIN); c[5] = rehash({ ...c[5], t: 9007199254740992 }); return c; })();
  const bigText = sub(J(bigT), '"t": 9007199254740992', '"t": 9007199254740993');
  cli('cl-number-text-json', ['REQ-IF-006', 'REQ-CL-002', 'REQ-CL-004'], ['verify', 'b.json', '--json'], { 'b.json': bigText }, { na: ['reference'] });
  cli('cl-number-text-exit', ['REQ-IF-006', 'REQ-CL-003'], ['verify', 'b.json'], { 'b.json': bigText });
  // usage errors
  cli('cl-usage-none', ['REQ-CL-001', 'REQ-CL-003'], [], {}, { expect: { exit: 2 } });
  cli('cl-usage-not-verify', ['REQ-CL-001', 'REQ-CL-003'], ['check', 'chain.json'], F, { expect: { exit: 2 }, na: ['reference'] });
  cli('cl-usage-no-chain', ['REQ-CL-001', 'REQ-CL-003'], ['verify'], F, { expect: { exit: 2 } });
  cli('cl-usage-no-chain-json', ['REQ-CL-001', 'REQ-CL-003'], ['verify', '--json'], F, { expect: { exit: 2 }, na: ['reference'] });
  cli('cl-usage-bad-option', ['REQ-CL-001', 'REQ-CL-003'], ['verify', 'chain.json', '--yaml'], F, { expect: { exit: 2 }, na: ['reference'] });
  cli('cl-usage-head-no-value', ['REQ-CL-001', 'REQ-CL-003'], ['verify', 'chain.json', '--head'], F, { expect: { exit: 2 }, na: ['reference'] });
  cli('cl-usage-three-files', ['REQ-CL-001', 'REQ-CL-003'], ['verify', 'chain.json', 'rover.json', 'chain.json'], F, { expect: { exit: 2 }, na: ['reference'] });
  cli('cl-usage-before-input', ['REQ-CL-001', 'REQ-CL-003'], ['verify', 'nope.json', '--yaml'], {}, { expect: { exit: 2 }, na: ['reference'] });
  // input errors
  cli('cl-input-missing', ['REQ-CL-003'], ['verify', 'nope.json'], {}, { expect: { exit: 3 }, na: ['reference'] });
  cli('cl-input-not-json', ['REQ-CL-003'], ['verify', 'bad.json'], { 'bad.json': '[{"seq":0,' }, { expect: { exit: 3 }, na: ['reference'] });
  cli('cl-input-not-array', ['REQ-CL-002', 'REQ-CL-003'], ['verify', 'obj.json'], { 'obj.json': '{"seq":0}' }, { expect: { exit: 3 }, na: ['reference'] });
  cli('cl-input-shape', ['REQ-CL-002', 'REQ-CL-003'], ['verify', 's.json'], { 's.json': J(CHAIN.map((r) => { const { prev, ...x } = r; return x; })) }, { expect: { exit: 3 }, na: ['reference'] });
  cli('cl-input-envelope-array', ['REQ-CL-002', 'REQ-CL-003'], ['verify', 'chain.json', 'e.json'], { 'chain.json': J(CHAIN), 'e.json': '[]' }, { expect: { exit: 3 }, na: ['reference'] });
  cli('cl-input-overflow', ['REQ-CL-002', 'REQ-CL-003'], ['verify', 'o.json'], { 'o.json': sub(J(CHAIN), `"t": ${CHAIN[0].t}`, '"t": 1e999') }, { expect: { exit: 3 }, na: ['reference'] });
  cli('cl-input-envelope-missing-file', ['REQ-CL-003'], ['verify', 'chain.json', 'none.json'], { 'chain.json': J(CHAIN) }, { expect: { exit: 3 }, na: ['reference'] });
  // One byte that is not UTF-8 inside a string: strict decoding is bad input (3); lenient decoding would
  // change the record and give a hash mismatch (1).
  const utfText = J(CHAIN), utfAt = utfText.indexOf('user:operator-01');
  const [utfA, utfB] = [utfText.slice(0, utfAt), utfText.slice(utfAt + 'user:operator-01'.length)];
  cli('cl-input-invalid-utf8', ['REQ-CL-002', 'REQ-CL-003'], ['verify', 'u.json'], { 'u.json': { base64: Buffer.concat([Buffer.from(utfA, 'utf8'), Buffer.from('user:operator-\xff1', 'latin1'), Buffer.from(utfB, 'utf8')]).toString('base64') } }, { expect: { exit: 3 }, na: ['reference'] });

  return cases;
}

// SPEC.md § 2.6 examples, checked at load by run.mjs.
export function specExamples(specText) {
  const sec = specText.split('### 2.6 Examples')[1]?.split('\n---')[0] ?? '';
  const rows = [...sec.matchAll(/^\| `(.+)` \| `(.+)` \|$/gm)].map((m) => ({ input: m[1], output: m[2] }));
  return rows.map(({ input, output }) => {
    const want = output.replace(/\\u([0-9a-fA-F]{4})/g, (s, h) => (parseInt(h, 16) >= 0x7f ? String.fromCharCode(parseInt(h, 16)) : s));
    let got;
    try { got = O.canonical(JSON.parse(input)); } catch (e) { got = `ERROR ${e.message}`; }
    return { input, want, got, ok: got === want };
  });
}
