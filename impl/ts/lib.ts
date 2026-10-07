import { createHash } from 'node:crypto';

export type J = any;
export class OpError extends Error {
  cat: string;
  constructor(cat: string) { super(cat); this.cat = cat; }
}
export const GENESIS = 'sha256:' + '0'.repeat(64);
export const isObj = (v: J) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: J, k: string) => Object.hasOwn(o, k);
const get = (o: J, k: string) => (isObj(o) && has(o, k) ? o[k] : undefined);
const isNum = (v: J) => typeof v === 'number';
const finite = (v: J) => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = (v: J) => typeof v === 'string' && v.length > 0;
// LS and PS built from code points so the source holds no raw line terminators.
const LSPS = String.fromCharCode(0x2028, 0x2029);

// Canonical JSON (RFC 8785). `skip` drops one top-level member before writing.
export function canon(v: J, skip?: string): string {
  if (v === null || typeof v === 'boolean') return String(v);
  if (isNum(v)) {
    if (!Number.isFinite(v)) throw new OpError('non_finite_number');
    return String(v);
  }
  if (typeof v === 'string') {
    if (!v.isWellFormed()) throw new OpError('invalid_string');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map((x) => canon(x)).join(',') + ']';
  const keys = Object.keys(v).filter((k) => k !== skip).sort(); // default sort = UTF-16 code units
  return '{' + keys.map((k) => canon(k) + ':' + canon(v[k])).join(',') + '}';
}
export const hashOf = (v: J, skip?: string) =>
  'sha256:' + createHash('sha256').update(canon(v, skip), 'utf8').digest('hex');

// ---- envelope validation (§ 4) ----
type Check = (v: J, p: string) => void;
export function validateEnvelope(envelope: J) {
  const errors: { path: string; code: string }[] = [];
  const E = (path: string, code: string) => { errors.push({ path, code }); };
  const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
  const prim = (ok: (v: J) => boolean, rule?: (v: J) => boolean): Check => (v, p) => {
    if (!ok(v)) E(p, 'type');
    else if (rule && !rule(v)) E(p, 'invalid_value');
  };
  const str = (rule?: (v: J) => boolean) => prim((v) => typeof v === 'string', rule);
  const number = (rule?: (v: J) => boolean) => prim(finite, rule);
  const integer = (rule?: (v: J) => boolean) => prim((v) => finite(v) && Number.isInteger(v), rule);
  const R = (c: Check): [Check, boolean] => [c, true];
  const O = (c: Check): [Check, boolean] => [c, false];
  const obj = (fields: Record<string, [Check, boolean]>, after?: Check): Check => (v, p) => {
    if (!isObj(v)) return E(p, 'type');
    for (const k of Object.keys(v)) if (!has(fields, k)) E(p + '/' + esc(k), 'unknown_member');
    for (const k of Object.keys(fields)) {
      if (has(v, k)) fields[k][0](v[k], p + '/' + k);
      else if (fields[k][1]) E(p + '/' + k, 'required');
    }
    after?.(v, p);
  };
  const arr = (elem: Check, after?: Check): Check => (v, p) => {
    if (!Array.isArray(v)) return E(p, 'type');
    v.forEach((x, i) => elem(x, p + '/' + i));
    after?.(v, p);
  };
  const plain = number();
  const point: Check = (v, p) => {
    if (!Array.isArray(v)) return E(p, 'type');
    if (v.length !== 2) E(p, 'invalid_value');
    v.slice(0, 2).forEach((x, i) => plain(x, p + '/' + i));
  };
  const polygon = arr(point, (v, p) => { if (v.length < 3) E(p, 'invalid_value'); });
  const pos = (x: J) => x > 0;
  const nonNeg = (x: J) => x >= 0;
  const oneOf = (...xs: J[]) => (x: J) => xs.includes(x);
  const nonEmptyStr = str((s) => s.length > 0);
  const sigRule = new RegExp('^[a-z0-9-]+:[^\\n\\r' + LSPS + ']+$');
  const top = obj({
    envelope_version: R(str((s) => /^0\.[0-9]+$/.test(s))),
    machine: R(obj({ id: R(nonEmptyStr), class: R(nonEmptyStr), mass_kg: O(number(pos)) })),
    level: R(str(oneOf('A1', 'A2', 'A3'))),
    workspace: R(obj({
      frame: R(nonEmptyStr), keep_in: R(polygon), keep_out: O(arr(polygon)), z_range_m: O(point),
    })),
    motion: R(obj({
      max_speed_mps: R(number(pos)), max_turn_radps: O(number(pos)),
      max_accel_mps2: O(number(pos)), max_joint_speed_radps: O(number(pos)),
    })),
    force: O(obj({ max_contact_force_n: O(number(pos)), max_payload_kg: O(number(nonNeg)) })),
    proximity: O(arr(obj({
      when: R(obj({ human_within_m: R(number(pos)) })),
      max_speed_mps: O(number(nonNeg)),
      action: O(str(oneOf('stop'))),
    }, (v, p) => { if (has(v, 'max_speed_mps') === has(v, 'action')) E(p, 'invalid_value'); }))),
    sensing: O(obj({ max_state_age_ms: O(integer(pos)) })),
    stop: R(obj({
      category: R(integer(oneOf(0, 1, 2))), max_time_ms: R(integer(pos)), max_distance_m: R(number(nonNeg)),
    })),
    heartbeat: R(obj({
      model_timeout_ms: R(integer(pos)), gate_timeout_ms: R(integer(pos)), on_loss: R(str(oneOf('stop'))),
    })),
    authority: O(obj({
      required_for: O(arr(str(), (v, p) => {
        const s = v.filter((x: J) => typeof x === 'string');
        if (new Set(s).size < s.length) E(p, 'invalid_value');
      })),
      resolver: O(str(oneOf('external', 'local'))),
    })),
    signature: O(str((s) => sigRule.test(s))),
  });
  top(envelope, '');
  return { valid: errors.length === 0, errors };
}

// ---- chain (§ 5) ----
export function checkRecords(records: J, withHashes: boolean) {
  for (const r of records) {
    if (!isObj(r) || !(finite(r.seq) && Number.isInteger(r.seq) && r.seq >= 0)) throw new OpError('bad_request');
    if (withHashes && (typeof r.prev !== 'string' || typeof r.hash !== 'string')) throw new OpError('bad_request');
  }
}
export function verifyChain(records: J[], expectedHead?: string) {
  const findings: J[] = [];
  records.forEach((r, i) => {
    const prev = records[i - 1];
    const f = (code: string) => findings.push({ seq: r.seq, code });
    if (i === 0 ? r.seq !== 0 : r.seq !== prev.seq + 1) f(i === 0 ? 'BAD_GENESIS' : 'SEQ_GAP');
    if (r.prev !== (i === 0 ? GENESIS : prev.hash)) f('PREV_MISMATCH');
    if (r.hash !== hashOf(r, 'hash')) f('HASH_MISMATCH');
  });
  const head = records.length ? records[records.length - 1].hash : GENESIS;
  if (expectedHead !== undefined && head !== expectedHead) findings.push({ seq: null, code: 'HEAD_MISMATCH' });
  return { findings, head, tail: expectedHead === undefined ? 'unverified' : 'anchored' };
}

// ---- authority (§ 6) ----
export function auditAuthority(records: J[], envelope: J) {
  const rf = get(get(envelope, 'authority'), 'required_for');
  const findings: J[] = [];
  for (const r of records) {
    if (r.decision !== 'allow' && r.decision !== 'clamp') continue;
    const kind = typeof get(r.cmd, 'kind') === 'string' ? r.cmd.kind : 'motion';
    if (!Array.isArray(rf) || !rf.some((x) => typeof x === 'string' && x === kind)) continue;
    if (!nonEmpty(r.principal)) findings.push({ seq: r.seq, code: 'NO_PRINCIPAL' });
    if (!nonEmpty(r.authority)) findings.push({ seq: r.seq, code: 'NO_AUTHORITY' });
  }
  return { findings };
}

// ---- replay (§ 7) ----
const isPoint = (v: J) => Array.isArray(v) && v.length === 2 && v.every((x) => finite(x));
const isPoly = (v: J) => Array.isArray(v) && v.length >= 3 && v.every((x) => isPoint(x));
// Inside or on the boundary (within 1e-9 of an edge counts as on it).
function inside([x, y]: number[], poly: number[][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= 1e-9) return true;
    if ((ay > y) !== (by > y) && x < ax + ((y - ay) * dx) / dy) c = !c;
  }
  return c;
}
export function replay(records: J[], envelope: J) {
  const H = hashOf(envelope, 'signature');
  const maxV = get(get(envelope, 'motion'), 'max_speed_mps');
  const maxW = get(get(envelope, 'motion'), 'max_turn_radps');
  const ws = get(envelope, 'workspace');
  const keepIn = isPoly(get(ws, 'keep_in')) ? ws.keep_in : null;
  const ko = get(ws, 'keep_out');
  const keepOut: number[][][] = Array.isArray(ko) ? ko.filter((p) => isPoly(p)) : [];
  const findings: J[] = [];
  const unchecked = new Set<string>();
  for (const r of records) {
    const f = (code: string) => findings.push({ seq: r.seq, code });
    const d = r.decision, a = r.applied;
    if (r.envelope !== H) f('ENVELOPE_MISMATCH');
    if (!['allow', 'clamp', 'reject', 'stop'].includes(d)) { f('UNKNOWN_DECISION'); continue; }
    if (d === 'reject') {
      if (!(has(r, 'applied') && a === null)) f('REJECT_APPLIED');
    } else if (!isObj(a)) f('APPLIED_NOT_OBJECT');
    else {
      if (d === 'stop') {
        if ((isNum(a.linear_mps) && a.linear_mps !== 0) || (isNum(a.angular_radps) && a.angular_radps !== 0)) f('STOP_WITH_MOTION');
      } else {
        if (isNum(a.linear_mps) && isNum(maxV) && Math.abs(a.linear_mps) > maxV) f('SPEED_EXCEEDED');
        if (isNum(a.angular_radps) && isNum(maxW) && Math.abs(a.angular_radps) > maxW) f('TURN_EXCEEDED');
        if (isPoint(a.target)) {
          if (keepIn && !inside(a.target, keepIn)) f('OUTSIDE_KEEP_IN');
          for (const p of keepOut) if (inside(a.target, p)) f('INSIDE_KEEP_OUT');
        }
        if (d === 'allow' && canon(a) !== canon(r.cmd ?? null)) f('ALLOW_MODIFIED');
      }
      for (const k of Object.keys(a)) {
        const v = a[k];
        const judged = k === 'kind' || ((k === 'linear_mps' || k === 'angular_radps') && isNum(v)) ||
          (k === 'target' && d !== 'stop' && isPoint(v));
        if (!judged) unchecked.add(k);
      }
    }
    if (d !== 'allow' && !nonEmpty(r.reason)) f('MISSING_REASON');
  }
  for (const field of [...unchecked].sort()) findings.push({ seq: null, code: 'UNCHECKED_FIELDS', field });
  return { findings };
}

// ---- driver operations (§ 1.3) ----
type Op = [Record<string, string>, (i: J) => J];
export const OPS: Record<string, Op> = {
  canonical: [{ value: 'any' }, (i) => Buffer.from(canon(i.value), 'utf8').toString('base64')],
  envelopeHash: [{ envelope: 'object' }, (i) => hashOf(i.envelope, 'signature')],
  recordHash: [{ record: 'object' }, (i) => hashOf(i.record, 'hash')],
  validateEnvelope: [{ envelope: 'any' }, (i) => validateEnvelope(i.envelope)],
  verifyChain: [{ records: 'array' }, (i) => verifyChain(i.records, i.expectedHead)],
  auditAuthority: [{ records: 'array', envelope: 'object' }, (i) => auditAuthority(i.records, i.envelope)],
  replay: [{ records: 'array', envelope: 'object' }, (i) => replay(i.records, i.envelope)],
};
export function run(op: string, input: J) {
  const [need, fn] = OPS[op];
  if (!isObj(input)) throw new OpError('bad_request');
  for (const [k, t] of Object.entries(need)) {
    const ok = has(input, k) && (t === 'any' || (t === 'array' ? Array.isArray(input[k]) : isObj(input[k])));
    if (!ok) throw new OpError('bad_request');
  }
  if (op === 'verifyChain' && has(input, 'expectedHead') && typeof input.expectedHead !== 'string') throw new OpError('bad_request');
  if (need.records) checkRecords(input.records, op === 'verifyChain');
  return fn(input);
}
