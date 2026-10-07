import { createHash } from "node:crypto";

export class Bad extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
type J = any;
export const GENESIS = "sha256:" + "0".repeat(64);
const isObj = (v: J) => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: J, k: string) => Object.hasOwn(o, k);
const get = (o: J, k: string) => (isObj(o) && has(o, k) ? o[k] : undefined);
const isNum = (v: J) => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: J) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const isPoly = (v: J) => Array.isArray(v) && v.length >= 3 && v.every(isPoint);
const nes = (v: J) => typeof v === "string" && v.length > 0;

// ---- canonical JSON (§ 2) ----
export function canon(v: J, skip?: string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Bad("non_finite_number");
    return String(v);
  }
  if (typeof v === "string") {
    if (!v.isWellFormed()) throw new Bad("invalid_string");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map((x) => canon(x)).join(",") + "]";
  const keys = Object.keys(v).filter((k) => k !== skip).sort();
  return "{" + keys.map((k) => canon(k) + ":" + canon(v[k])).join(",") + "}";
}
export const hashOf = (v: J, skip?: string) =>
  "sha256:" + createHash("sha256").update(Buffer.from(canon(v, skip), "utf8")).digest("hex");

// ---- envelope validation (§ 4) ----
type Fn = (v: J, p: string, e: J[]) => void;
const esc = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const add = (e: J[], path: string, code: string) => e.push({ path, code });
const prim = (t: string, test?: (v: J) => boolean): Fn => (v, p, e) => {
  const ok = t === "number" ? isNum(v) : t === "integer" ? isNum(v) && Number.isInteger(v) : typeof v === "string";
  if (!ok) return add(e, p, "type");
  if (test && !test(v)) add(e, p, "invalid_value");
};
const obj = (spec: Record<string, [boolean, Fn]>, extra?: Fn): Fn => (v, p, e) => {
  if (!isObj(v)) return add(e, p, "type");
  for (const k of Object.keys(v)) if (!has(spec, k)) add(e, p + "/" + esc(k), "unknown_member");
  for (const k of Object.keys(spec)) {
    if (has(v, k)) spec[k][1](v[k], p + "/" + esc(k), e);
    else if (spec[k][0]) add(e, p + "/" + esc(k), "required");
  }
  if (extra) extra(v, p, e);
};
const arrOf = (el: Fn, minLen = 0, whole?: Fn): Fn => (v, p, e) => {
  if (!Array.isArray(v)) return add(e, p, "type");
  if (v.length < minLen) add(e, p, "invalid_value");
  v.forEach((x, i) => el(x, p + "/" + i, e));
  if (whole) whole(v, p, e);
};
const point: Fn = (v, p, e) => {
  if (!Array.isArray(v)) return add(e, p, "type");
  if (v.length !== 2) add(e, p, "invalid_value");
  for (let i = 0; i < Math.min(2, v.length); i++) if (!isNum(v[i])) add(e, p + "/" + i, "type");
};
const polygon: Fn = arrOf(point, 3);
const pos = prim("number", (x) => x > 0);
const nonneg = prim("number", (x) => x >= 0);
const posInt = prim("integer", (x) => x > 0);
const nonEmpty = prim("string", (x) => x.length > 0);
const proximity: Fn = obj(
  {
    when: [true, obj({ human_within_m: [true, pos] })],
    max_speed_mps: [false, nonneg],
    action: [false, prim("string", (x) => x === "stop")],
  },
  (v, p, e) => {
    if (has(v, "max_speed_mps") === has(v, "action")) add(e, p, "invalid_value");
  },
);
const dupes: Fn = (v, p, e) => {
  const s = v.filter((x: J) => typeof x === "string");
  if (new Set(s).size !== s.length) add(e, p, "invalid_value");
};
const envSpec = obj({
  envelope_version: [true, prim("string", (x) => /^0\.[0-9]+$/.test(x))],
  machine: [true, obj({ id: [true, nonEmpty], class: [true, nonEmpty], mass_kg: [false, pos] })],
  level: [true, prim("string", (x) => ["A1", "A2", "A3"].includes(x))],
  workspace: [true, obj({
    frame: [true, nonEmpty],
    keep_in: [true, polygon],
    keep_out: [false, arrOf(polygon)],
    z_range_m: [false, point],
  })],
  motion: [true, obj({
    max_speed_mps: [true, pos],
    max_turn_radps: [false, pos],
    max_accel_mps2: [false, pos],
    max_joint_speed_radps: [false, pos],
  })],
  force: [false, obj({ max_contact_force_n: [false, pos], max_payload_kg: [false, nonneg] })],
  proximity: [false, arrOf(proximity)],
  sensing: [false, obj({ max_state_age_ms: [false, posInt] })],
  stop: [true, obj({
    category: [true, prim("integer", (x) => x === 0 || x === 1 || x === 2)],
    max_time_ms: [true, posInt],
    max_distance_m: [true, nonneg],
  })],
  heartbeat: [true, obj({
    model_timeout_ms: [true, posInt],
    gate_timeout_ms: [true, posInt],
    on_loss: [true, prim("string", (x) => x === "stop")],
  })],
  authority: [false, obj({
    required_for: [false, arrOf(prim("string"), 0, dupes)],
    resolver: [false, prim("string", (x) => x === "external" || x === "local")],
  })],
  signature: [false, prim("string", (x) => /^[a-z0-9-]+:/.test(x) && x.length > x.indexOf(":") + 1 && ![...x.slice(x.indexOf(":"))].some((c) => "\n\r\u2028\u2029".includes(c)))],
});
export function validateEnvelope(env: J) {
  const errors: J[] = [];
  envSpec(env, "", errors);
  return { valid: errors.length === 0, errors };
}

// ---- chain (§ 5) ----
export function checkRecords(records: J, chain: boolean) {
  const ok = Array.isArray(records) && records.every((r) =>
    isObj(r) && Number.isInteger(r.seq) && r.seq >= 0 &&
    (!chain || (typeof r.prev === "string" && typeof r.hash === "string")));
  if (!ok) throw new Bad("bad_request");
}
export function verifyChain(records: J[], expectedHead?: string) {
  const hashes = records.map((r) => hashOf(r, "hash"));
  const findings: J[] = [];
  records.forEach((r, i) => {
    const f = (code: string) => findings.push({ seq: r.seq, code });
    if (i === 0 && r.seq !== 0) f("BAD_GENESIS");
    if (i > 0 && r.seq !== records[i - 1].seq + 1) f("SEQ_GAP");
    if (r.prev !== (i === 0 ? GENESIS : records[i - 1].hash)) f("PREV_MISMATCH");
    if (r.hash !== hashes[i]) f("HASH_MISMATCH");
  });
  const head = records.length ? records[records.length - 1].hash : GENESIS;
  if (expectedHead === undefined) return { findings, head, tail: "unverified" };
  if (head !== expectedHead) findings.push({ seq: null, code: "HEAD_MISMATCH" });
  return { findings, head, tail: "anchored" };
}

// ---- authority (§ 6) ----
export const executed = (r: J) => r.decision === "allow" || r.decision === "clamp";
export function auditAuthority(records: J[], env: J) {
  const rf = get(get(env, "authority"), "required_for");
  const gatedKinds = Array.isArray(rf) ? rf.filter((x) => typeof x === "string") : [];
  const findings: J[] = [];
  for (const r of records) {
    if (!executed(r)) continue;
    const k = get(r.cmd, "kind");
    if (!gatedKinds.includes(typeof k === "string" ? k : "motion")) continue;
    if (!nes(r.principal)) findings.push({ seq: r.seq, code: "NO_PRINCIPAL" });
    if (!nes(r.authority)) findings.push({ seq: r.seq, code: "NO_AUTHORITY" });
  }
  return { findings };
}

// ---- replay (§ 7) ----
function inside(pt: number[], poly: number[][]): boolean {
  const [x, y] = pt;
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
    if (cross === 0 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function replay(records: J[], env: J) {
  const H = hashOf(env, "signature");
  const ws = get(env, "workspace");
  const maxS = get(get(env, "motion"), "max_speed_mps");
  const maxT = get(get(env, "motion"), "max_turn_radps");
  const keepIn = get(ws, "keep_in");
  const ko = get(ws, "keep_out");
  const keepOut: J[] = Array.isArray(ko) ? ko.filter(isPoly) : [];
  const findings: J[] = [];
  const unchecked = new Set<string>();
  const num = (v: J) => typeof v === "number";
  for (const r of records) {
    const f = (code: string) => findings.push({ seq: r.seq, code });
    if (r.envelope !== H) f("ENVELOPE_MISMATCH");
    const d = r.decision;
    if (d !== "allow" && d !== "clamp" && d !== "reject" && d !== "stop") {
      f("UNKNOWN_DECISION");
      continue;
    }
    const a = r.applied;
    if (d === "reject") {
      if (!has(r, "applied") || a !== null) f("REJECT_APPLIED");
    } else if (!isObj(a)) f("APPLIED_NOT_OBJECT");
    else {
      for (const k of Object.keys(a)) {
        const ok = k === "kind" || ((k === "linear_mps" || k === "angular_radps") && num(a[k])) ||
          (k === "target" && d !== "stop" && isPoint(a[k]));
        if (!ok) unchecked.add(k);
      }
      if (d === "stop") {
        if ((num(a.linear_mps) && a.linear_mps !== 0) || (num(a.angular_radps) && a.angular_radps !== 0)) f("STOP_WITH_MOTION");
      } else {
        if (num(a.linear_mps) && num(maxS) && Math.abs(a.linear_mps) > maxS) f("SPEED_EXCEEDED");
        if (num(a.angular_radps) && num(maxT) && Math.abs(a.angular_radps) > maxT) f("TURN_EXCEEDED");
        if (isPoint(a.target)) {
          if (isPoly(keepIn) && !inside(a.target, keepIn)) f("OUTSIDE_KEEP_IN");
          for (const poly of keepOut) if (inside(a.target, poly)) f("INSIDE_KEEP_OUT");
        }
        if (d === "allow" && canon(a) !== canon(has(r, "cmd") ? r.cmd : null)) f("ALLOW_MODIFIED");
      }
    }
    if (d !== "allow" && !nes(r.reason)) f("MISSING_REASON");
  }
  for (const field of [...unchecked].sort()) findings.push({ seq: null, code: "UNCHECKED_FIELDS", field });
  return { findings };
}

// ---- operations (§ 1.3) ----
export function run(op: string, input: J): J {
  const need = (k: string, ok: (v: J) => boolean) => {
    if (!has(input, k) || !ok(input[k])) throw new Bad("bad_request");
    return input[k];
  };
  if (!isObj(input)) throw new Bad("bad_request");
  switch (op) {
    case "canonical": need("value", () => true); return Buffer.from(canon(input.value), "utf8").toString("base64");
    case "envelopeHash": return hashOf(need("envelope", isObj), "signature");
    case "recordHash": return hashOf(need("record", isObj), "hash");
    case "validateEnvelope": need("envelope", () => true); return validateEnvelope(input.envelope);
    case "verifyChain": {
      const recs = need("records", Array.isArray);
      if (has(input, "expectedHead") && typeof input.expectedHead !== "string") throw new Bad("bad_request");
      checkRecords(recs, true);
      return verifyChain(recs, input.expectedHead);
    }
    case "auditAuthority":
    case "replay": {
      const recs = need("records", Array.isArray);
      const env = need("envelope", isObj);
      checkRecords(recs, false);
      return op === "replay" ? replay(recs, env) : auditAuthority(recs, env);
    }
  }
  throw new Bad("unknown_op");
}
export const OPS = ["canonical", "envelopeHash", "recordHash", "validateEnvelope", "verifyChain", "auditAuthority", "replay"];
