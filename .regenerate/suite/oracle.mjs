// The suite's executable model of SPEC.md. Expected values for generated cases come from here.
// It is checked against SPEC.md's own examples at load (run.mjs) and against the earlier
// implementation in r00 (every difference is explained in DECISIONS.md). Node standard library only.
import { createHash } from 'node:crypto';

export const GENESIS = 'sha256:' + '0'.repeat(64);

export class SpecError extends Error {
  constructor(category) { super(category); this.category = category; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number';
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------- canonical JSON (SPEC § 2)
export function numberText(x) {
  if (!Number.isFinite(x)) throw new SpecError('non_finite_number');
  return Object.is(x, -0) ? '0' : String(x); // ECMAScript Number::toString
}
export function canonical(v) {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return numberText(v);
  if (typeof v === 'string') {
    if (!v.isWellFormed()) throw new SpecError('invalid_string');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).sort(); // UTF-16 code unit order
  return '{' + keys.map((k) => {
    if (!k.isWellFormed()) throw new SpecError('invalid_string');
    return JSON.stringify(k) + ':' + canonical(v[k]);
  }).join(',') + '}';
}
export const canonicalBytes = (v) => Buffer.from(canonical(v), 'utf8');
export const sha256Text = (v) => 'sha256:' + createHash('sha256').update(canonicalBytes(v)).digest('hex');

const without = (obj, key) => { const { [key]: _drop, ...rest } = obj; return rest; };
export function envelopeHash(env) {
  if (!isObj(env)) throw new SpecError('bad_request');
  return sha256Text(without(env, 'signature'));
}
export function recordHash(rec) {
  if (!isObj(rec)) throw new SpecError('bad_request');
  return sha256Text(without(rec, 'hash'));
}

// ---------------------------------------------------------------- envelope rules (SPEC § 4)
const esc = (k) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const at = (p, k) => `${p}/${esc(String(k))}`;

const NUM = (rule) => ({ kind: 'number', ...rule });
const INT = (rule) => ({ kind: 'integer', ...rule });
const STR = (rule) => ({ kind: 'string', ...rule });
const OBJ = (members, required = []) => ({ kind: 'object', members, required });
const POINT = { kind: 'point' };
const POLYGON = { kind: 'polygon' };

const RULES = OBJ({
  envelope_version: STR({ test: (s) => /^0\.[0-9]+$/.test(s) && !s.includes('\n') }),
  machine: OBJ({
    id: STR({ min1: true }),
    class: STR({ min1: true }),
    mass_kg: NUM({ gt: 0 }),
  }, ['id', 'class']),
  level: STR({ oneOf: ['A1', 'A2', 'A3'] }),
  workspace: OBJ({
    frame: STR({ min1: true }),
    keep_in: POLYGON,
    keep_out: { kind: 'array', items: POLYGON },
    z_range_m: { kind: 'pair' },
  }, ['frame', 'keep_in']),
  motion: OBJ({
    max_speed_mps: NUM({ gt: 0 }),
    max_turn_radps: NUM({ gt: 0 }),
    max_accel_mps2: NUM({ gt: 0 }),
    max_joint_speed_radps: NUM({ gt: 0 }),
  }, ['max_speed_mps']),
  force: OBJ({
    max_contact_force_n: NUM({ gt: 0 }),
    max_payload_kg: NUM({ ge: 0 }),
  }),
  proximity: { kind: 'array', items: { kind: 'proximityRule' } },
  sensing: OBJ({ max_state_age_ms: INT({ gt: 0 }) }),
  stop: OBJ({
    category: INT({ oneOf: [0, 1, 2] }),
    max_time_ms: INT({ gt: 0 }),
    max_distance_m: NUM({ ge: 0 }),
  }, ['category', 'max_time_ms', 'max_distance_m']),
  heartbeat: OBJ({
    model_timeout_ms: INT({ gt: 0 }),
    gate_timeout_ms: INT({ gt: 0 }),
    on_loss: STR({ oneOf: ['stop'] }),
  }, ['model_timeout_ms', 'gate_timeout_ms', 'on_loss']),
  authority: OBJ({
    required_for: { kind: 'array', items: STR({}), unique: true },
    resolver: STR({ oneOf: ['external', 'local'] }),
  }),
  signature: STR({ test: (s) => /^[a-z0-9-]+:[^\n\r\u2028\u2029]+$/.test(s) }),
}, ['envelope_version', 'machine', 'level', 'workspace', 'motion', 'stop', 'heartbeat']);

const PROX = OBJ({
  when: OBJ({ human_within_m: NUM({ gt: 0 }) }, ['human_within_m']),
  max_speed_mps: NUM({ ge: 0 }),
  action: STR({ oneOf: ['stop'] }),
}, ['when']);

function check(rule, v, path, errs) {
  const err = (code, p = path) => errs.push({ path: p, code });
  switch (rule.kind) {
    case 'object': {
      if (!isObj(v)) return err('type');
      // Own members only: `constructor` or `__proto__` in the JSON text is an ordinary name.
      for (const k of Object.keys(v)) if (!Object.hasOwn(rule.members, k)) err('unknown_member', at(path, k));
      for (const k of rule.required) if (!Object.hasOwn(v, k)) err('required', at(path, k));
      for (const [k, sub] of Object.entries(rule.members)) if (Object.hasOwn(v, k)) check(sub, v[k], at(path, k), errs);
      return;
    }
    case 'number':
    case 'integer': {
      if (!isFiniteNum(v) || (rule.kind === 'integer' && !Number.isInteger(v))) return err('type');
      if (rule.gt !== undefined && !(v > rule.gt)) return err('invalid_value');
      if (rule.ge !== undefined && !(v >= rule.ge)) return err('invalid_value');
      if (rule.oneOf && !rule.oneOf.includes(v)) return err('invalid_value');
      return;
    }
    case 'string': {
      if (typeof v !== 'string') return err('type');
      if (rule.min1 && v.length === 0) return err('invalid_value');
      if (rule.oneOf && !rule.oneOf.includes(v)) return err('invalid_value');
      if (rule.test && !rule.test(v)) return err('invalid_value');
      return;
    }
    case 'array': {
      if (!Array.isArray(v)) return err('type');
      v.forEach((item, i) => check(rule.items, item, at(path, i), errs));
      if (rule.unique) {
        const strings = v.filter((x) => typeof x === 'string');
        if (new Set(strings).size !== strings.length) err('invalid_value');
      }
      return;
    }
    case 'pair':
    case 'point': {
      if (!Array.isArray(v)) return err('type');
      if (v.length !== 2) err('invalid_value');
      v.slice(0, 2).forEach((x, i) => { if (!isFiniteNum(x)) err('type', at(path, i)); });
      return;
    }
    case 'polygon': {
      if (!Array.isArray(v)) return err('type');
      if (v.length < 3) err('invalid_value');
      v.forEach((pt, i) => check(POINT, pt, at(path, i), errs));
      return;
    }
    case 'proximityRule': {
      check(PROX, v, path, errs);
      if (isObj(v) && Object.hasOwn(v, 'max_speed_mps') === Object.hasOwn(v, 'action')) err('invalid_value');
      return;
    }
    default: throw new Error(`unknown rule ${rule.kind}`);
  }
}
export function validateEnvelope(env) {
  const errors = [];
  check(RULES, env, '', errors);
  errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------- chain checks (SPEC § 5–7)
export function checkRecords(records, needLinks) {
  if (!Array.isArray(records)) throw new SpecError('bad_request');
  for (const r of records) {
    if (!isObj(r) || !Number.isInteger(r.seq) || r.seq < 0) throw new SpecError('bad_request');
    if (needLinks && (typeof r.prev !== 'string' || typeof r.hash !== 'string')) throw new SpecError('bad_request');
  }
}

export function verifyChain(records, expectedHead) {
  checkRecords(records, true);
  if (expectedHead !== undefined && typeof expectedHead !== 'string') throw new SpecError('bad_request');
  const findings = [];
  records.forEach((rec, i) => {
    if (i === 0 && rec.seq !== 0) findings.push({ seq: rec.seq, code: 'BAD_GENESIS' });
    if (i > 0 && rec.seq !== records[i - 1].seq + 1) findings.push({ seq: rec.seq, code: 'SEQ_GAP' });
    const expectedPrev = i === 0 ? GENESIS : records[i - 1].hash;
    if (rec.prev !== expectedPrev) findings.push({ seq: rec.seq, code: 'PREV_MISMATCH' });
    if (recordHash(rec) !== rec.hash) findings.push({ seq: rec.seq, code: 'HASH_MISMATCH' });
  });
  const head = records.length ? records[records.length - 1].hash : GENESIS;
  if (expectedHead !== undefined && head !== expectedHead) findings.push({ seq: null, code: 'HEAD_MISMATCH' });
  return { findings, head, tail: expectedHead === undefined ? 'unverified' : 'anchored' };
}

const nonEmptyString = (v) => typeof v === 'string' && v.length > 0;

export function auditAuthority(records, envelope) {
  checkRecords(records, false);
  if (!isObj(envelope)) throw new SpecError('bad_request');
  const rf = isObj(envelope.authority) && Array.isArray(envelope.authority.required_for) ? envelope.authority.required_for : [];
  const gated = new Set(rf.filter((x) => typeof x === 'string'));
  const findings = [];
  for (const rec of records) {
    if (rec.decision !== 'allow' && rec.decision !== 'clamp') continue;
    const kind = isObj(rec.cmd) && typeof rec.cmd.kind === 'string' ? rec.cmd.kind : 'motion';
    if (!gated.has(kind)) continue;
    if (!nonEmptyString(rec.principal)) findings.push({ seq: rec.seq, code: 'NO_PRINCIPAL' });
    if (!nonEmptyString(rec.authority)) findings.push({ seq: rec.seq, code: 'NO_AUTHORITY' });
  }
  return { findings };
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && isFiniteNum(p[0]) && isFiniteNum(p[1]);
const isPolygon = (poly) => Array.isArray(poly) && poly.length >= 3 && poly.every(isPoint);

export function insideOrOn([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (cross === 0 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const DECISIONS = new Set(['allow', 'clamp', 'reject', 'stop']);
// REQ-RP-004: which members of an applied object replay judges.
const judged = (d, k, v) => k === 'kind' || ((k === 'linear_mps' || k === 'angular_radps') && isNum(v)) || (k === 'target' && d !== 'stop' && isPoint(v));

export function replay(records, envelope) {
  checkRecords(records, false);
  if (!isObj(envelope)) throw new SpecError('bad_request');
  const hash = envelopeHash(envelope);
  const motion = isObj(envelope.motion) ? envelope.motion : {};
  const ws = isObj(envelope.workspace) ? envelope.workspace : {};
  const maxV = isFiniteNum(motion.max_speed_mps) ? motion.max_speed_mps : undefined;
  const maxW = isFiniteNum(motion.max_turn_radps) ? motion.max_turn_radps : undefined;
  const keepIn = isPolygon(ws.keep_in) ? ws.keep_in : undefined;
  const keepOut = Array.isArray(ws.keep_out) ? ws.keep_out : [];
  const unchecked = [];
  const findings = [];
  for (const rec of records) {
    const f = (code) => findings.push({ seq: rec.seq, code });
    if (rec.envelope !== hash) f('ENVELOPE_MISMATCH');
    const d = rec.decision;
    if (!DECISIONS.has(d)) { f('UNKNOWN_DECISION'); continue; }
    if (d === 'reject') {
      if (!Object.hasOwn(rec, 'applied') || rec.applied !== null) f('REJECT_APPLIED');
    } else if (!isObj(rec.applied)) {
      f('APPLIED_NOT_OBJECT');
    } else {
      const a = rec.applied;
      for (const k of Object.keys(a)) if (!judged(d, k, a[k]) && !unchecked.includes(k)) unchecked.push(k);
      const v = isNum(a.linear_mps) ? a.linear_mps : undefined;
      const w = isNum(a.angular_radps) ? a.angular_radps : undefined;
      if (d === 'stop') {
        if ((v !== undefined && v !== 0) || (w !== undefined && w !== 0)) f('STOP_WITH_MOTION');
      } else {
        if (v !== undefined && maxV !== undefined && Math.abs(v) > maxV) f('SPEED_EXCEEDED');
        if (w !== undefined && maxW !== undefined && Math.abs(w) > maxW) f('TURN_EXCEEDED');
        if (isPoint(a.target)) {
          if (keepIn && !insideOrOn(a.target, keepIn)) f('OUTSIDE_KEEP_IN');
          for (const zone of keepOut) if (isPolygon(zone) && insideOrOn(a.target, zone)) f('INSIDE_KEEP_OUT');
        }
        if (d === 'allow' && canonical(a) !== canonical(rec.cmd ?? null)) f('ALLOW_MODIFIED');
      }
    }
    if (d !== 'allow' && !nonEmptyString(rec.reason)) f('MISSING_REASON');
  }
  for (const k of unchecked.sort()) findings.push({ seq: null, code: 'UNCHECKED_FIELDS', field: k }); // UTF-16 order
  return { findings };
}

// ---------------------------------------------------------------- driver ops (SPEC § 1.3)
export function runOp(op, input) {
  const need = (k, test) => { if (!Object.hasOwn(input, k) || !test(input[k])) throw new SpecError('bad_request'); };
  switch (op) {
    case 'canonical': need('value', () => true); return canonicalBytes(input.value).toString('base64');
    case 'envelopeHash': need('envelope', isObj); return envelopeHash(input.envelope);
    case 'recordHash': need('record', isObj); return recordHash(input.record);
    case 'validateEnvelope': need('envelope', () => true); return validateEnvelope(input.envelope);
    case 'verifyChain': need('records', Array.isArray); return verifyChain(input.records, input.expectedHead);
    case 'auditAuthority': need('records', Array.isArray); need('envelope', isObj); return auditAuthority(input.records, input.envelope);
    case 'replay': need('records', Array.isArray); need('envelope', isObj); return replay(input.records, input.envelope);
    default: throw new SpecError('unknown_op');
  }
}
export const OPS = ['canonical', 'envelopeHash', 'recordHash', 'validateEnvelope', 'verifyChain', 'auditAuthority', 'replay'];

// ---------------------------------------------------------------- CLI model (SPEC § 8)
export function cliModel({ chain, envelope, head }) {
  // chain/envelope are parsed JSON values (or undefined); returns { exit, report }
  try {
    checkRecords(chain, true);
    if (envelope !== undefined && !isObj(envelope)) throw new SpecError('bad_input');
    const vc = verifyChain(chain, head);
    const findings = [...vc.findings];
    let env = null;
    if (envelope !== undefined) {
      env = validateEnvelope(envelope);
      findings.push(...auditAuthority(chain, envelope).findings, ...replay(chain, envelope).findings);
    }
    const hard = findings.filter((x) => x.code !== 'UNCHECKED_FIELDS');
    const ok = hard.length === 0 && (env === null || env.valid);
    return { exit: ok ? 0 : 1, report: { ok, records: chain.length, tail: vc.tail, envelope: env, findings } };
  } catch (e) {
    if (e instanceof SpecError) return { exit: 3, report: null };
    throw e;
  }
}
