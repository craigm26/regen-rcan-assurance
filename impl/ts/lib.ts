import { createHash } from "node:crypto";

export class OpError extends Error {
  category: string;
  constructor(category: string) {
    super(category);
    this.category = category;
  }
}

const has = (o: any, k: string): boolean => Object.hasOwn(o, k);
export const isObj = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: any): boolean => typeof v === "number" && Number.isFinite(v);
const isInt = (v: any): boolean => isNum(v) && Number.isInteger(v);
const isStr = (v: any): boolean => typeof v === "string";
const nonEmpty = (v: any): boolean => isStr(v) && v.length > 0;
const get = (o: any, k: string): any => (isObj(o) && has(o, k) ? o[k] : undefined);

// ---- canonical JSON (section 2) ----
const ESC: Record<string, string> = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r" };
function canonStr(s: string): string {
  if (!s.isWellFormed()) throw new OpError("invalid_string");
  return '"' + s.replace(/[\u0000-\u001f"\\]/g, (c) => ESC[c] ?? "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + '"';
}
export function canon(v: any, omit?: string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new OpError("non_finite_number");
    return String(v);
  }
  if (typeof v === "string") return canonStr(v);
  if (Array.isArray(v)) return "[" + v.map((x) => canon(x)).join(",") + "]";
  const keys = Object.keys(v).filter((k) => k !== omit).sort();
  return "{" + keys.map((k) => canonStr(k) + ":" + canon(v[k])).join(",") + "}";
}
export const canonicalB64 = (v: any): string => Buffer.from(canon(v), "utf8").toString("base64");
const sha = (s: string): string => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");
export const envelopeHash = (e: any): string => sha(canon(e, "signature"));
export const recordHash = (r: any): string => sha(canon(r, "hash"));

// ---- envelope validation (section 4) ----
type Err = { path: string; code: string };
type Rule = (v: any, p: string, out: Err[]) => void;
const esc = (s: string): string => s.replace(/~/g, "~0").replace(/\//g, "~1");
const typed = (ok: (v: any) => boolean, extra?: (v: any) => boolean): Rule => (v, p, out) => {
  if (!ok(v)) out.push({ path: p, code: "type" });
  else if (extra && !extra(v)) out.push({ path: p, code: "invalid_value" });
};
const str = (x?: (v: any) => boolean) => typed(isStr, x);
const num = (x?: (v: any) => boolean) => typed(isNum, x);
const int = (x?: (v: any) => boolean) => typed(isInt, x);
const obj = (members: Record<string, [boolean, Rule]>, after?: Rule): Rule => (v, p, out) => {
  if (!isObj(v)) return void out.push({ path: p, code: "type" });
  for (const k of Object.keys(v)) {
    if (has(members, k)) members[k][1](v[k], p + "/" + esc(k), out);
    else out.push({ path: p + "/" + esc(k), code: "unknown_member" });
  }
  for (const k of Object.keys(members)) if (members[k][0] && !has(v, k)) out.push({ path: p + "/" + esc(k), code: "required" });
  after?.(v, p, out);
};
const arr = (item: Rule, after?: Rule): Rule => (v, p, out) => {
  if (!Array.isArray(v)) return void out.push({ path: p, code: "type" });
  v.forEach((x, i) => item(x, p + "/" + i, out));
  after?.(v, p, out);
};
const point: Rule = (v, p, out) => {
  if (!Array.isArray(v)) return void out.push({ path: p, code: "type" });
  if (v.length !== 2) out.push({ path: p, code: "invalid_value" });
  for (let i = 0; i < Math.min(2, v.length); i++) if (!isNum(v[i])) out.push({ path: p + "/" + i, code: "type" });
};
const polygon: Rule = arr(point, (v, p, out) => {
  if (v.length < 3) out.push({ path: p, code: "invalid_value" });
});
const pos = (x: number) => x > 0;
const nonneg = (x: number) => x >= 0;
const nonEmptyStr = str((s) => s.length > 0);
const proximity = obj(
  {
    when: [true, obj({ human_within_m: [true, num(pos)] })],
    max_speed_mps: [false, num(nonneg)],
    action: [false, str((s) => s === "stop")],
  },
  (v, p, out) => {
    if (has(v, "max_speed_mps") === has(v, "action")) out.push({ path: p, code: "invalid_value" });
  },
);
const envelopeRule = obj({
  envelope_version: [true, str((s) => /^0\.[0-9]+$/.test(s))],
  machine: [true, obj({ id: [true, nonEmptyStr], class: [true, nonEmptyStr], mass_kg: [false, num(pos)] })],
  level: [true, str((s) => ["A1", "A2", "A3"].includes(s))],
  workspace: [true, obj({ frame: [true, nonEmptyStr], keep_in: [true, polygon], keep_out: [false, arr(polygon)], z_range_m: [false, point] })],
  motion: [true, obj({
    max_speed_mps: [true, num(pos)], max_turn_radps: [false, num(pos)],
    max_accel_mps2: [false, num(pos)], max_joint_speed_radps: [false, num(pos)],
  })],
  force: [false, obj({ max_contact_force_n: [false, num(pos)], max_payload_kg: [false, num(nonneg)] })],
  proximity: [false, arr(proximity)],
  sensing: [false, obj({ max_state_age_ms: [false, int(pos)] })],
  stop: [true, obj({
    category: [true, int((x) => x === 0 || x === 1 || x === 2)],
    max_time_ms: [true, int(pos)], max_distance_m: [true, num(nonneg)],
  })],
  heartbeat: [true, obj({
    model_timeout_ms: [true, int(pos)], gate_timeout_ms: [true, int(pos)],
    on_loss: [true, str((s) => s === "stop")],
  })],
  authority: [false, obj({
    required_for: [false, arr(str(), (v, p, out) => {
      const seen = new Set<string>();
      let dup = false;
      for (const x of v) if (isStr(x)) { if (seen.has(x)) dup = true; seen.add(x); }
      if (dup) out.push({ path: p, code: "invalid_value" });
    })],
    resolver: [false, str((s) => s === "external" || s === "local")],
  })],
  signature: [false, str((s) => /^[a-z0-9-]+:[^\n\r\u2028\u2029]+$/.test(s))],
});
export function validateEnvelope(env: any): { valid: boolean; errors: Err[] } {
  const errors: Err[] = [];
  envelopeRule(env, "", errors);
  return { valid: errors.length === 0, errors };
}

// ---- records (section 5) ----
type Finding = { seq: number | null; code: string; field?: string };
export const GENESIS = "sha256:" + "0".repeat(64);
export function recordsOk(records: any, strict: boolean): boolean {
  return Array.isArray(records) && records.every((r) =>
    isObj(r) && has(r, "seq") && isInt(r.seq) && r.seq >= 0 && (!strict || (isStr(get(r, "prev")) && isStr(get(r, "hash")))));
}
export function verifyChain(records: any[], expectedHead?: string) {
  const findings: Finding[] = [];
  records.forEach((r, i) => {
    const prev = records[i - 1];
    if (i === 0 && r.seq !== 0) findings.push({ seq: r.seq, code: "BAD_GENESIS" });
    if (i > 0 && r.seq !== prev.seq + 1) findings.push({ seq: r.seq, code: "SEQ_GAP" });
    if (r.prev !== (i === 0 ? GENESIS : prev.hash)) findings.push({ seq: r.seq, code: "PREV_MISMATCH" });
    if (r.hash !== recordHash(r)) findings.push({ seq: r.seq, code: "HASH_MISMATCH" });
  });
  const head = records.length ? records[records.length - 1].hash : GENESIS;
  if (expectedHead === undefined) return { findings, head, tail: "unverified" };
  if (head !== expectedHead) findings.push({ seq: null, code: "HEAD_MISMATCH" });
  return { findings, head, tail: "anchored" };
}

// ---- authority audit (section 6) ----
const executed = (r: any): boolean => r.decision === "allow" || r.decision === "clamp";
export function auditAuthority(records: any[], envelope: any) {
  const findings: Finding[] = [];
  const rf = get(get(envelope, "authority"), "required_for");
  const gated = Array.isArray(rf) ? rf.filter(isStr) : [];
  for (const r of records) {
    if (!executed(r)) continue;
    const kind = get(r.cmd, "kind");
    if (!gated.includes(isStr(kind) ? kind : "motion")) continue;
    if (!nonEmpty(get(r, "principal"))) findings.push({ seq: r.seq, code: "NO_PRINCIPAL" });
    if (!nonEmpty(get(r, "authority"))) findings.push({ seq: r.seq, code: "NO_AUTHORITY" });
  }
  return { findings };
}

// ---- replay (section 7) ----
const isPoint = (v: any): boolean => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const isPoly = (v: any): boolean => Array.isArray(v) && v.length >= 3 && v.every(isPoint);
function insideOrOn(pt: number[], poly: number[][]): boolean {
  const [x, y] = pt;
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
    if (cross === 0 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function replay(records: any[], envelope: any) {
  const H = envelopeHash(envelope);
  const motion = get(envelope, "motion"), ws = get(envelope, "workspace");
  const maxSpeed = get(motion, "max_speed_mps"), maxTurn = get(motion, "max_turn_radps");
  const keepIn = isPoly(get(ws, "keep_in")) ? get(ws, "keep_in") : null;
  const ko = get(ws, "keep_out");
  const keepOut: number[][][] = Array.isArray(ko) ? ko.filter(isPoly) : [];
  const findings: Finding[] = [];
  const unchecked = new Set<string>();
  for (const r of records) {
    const add = (code: string) => findings.push({ seq: r.seq, code });
    if (get(r, "envelope") !== H) add("ENVELOPE_MISMATCH");
    const d = r.decision;
    if (d !== "allow" && d !== "clamp" && d !== "reject" && d !== "stop") { add("UNKNOWN_DECISION"); continue; }
    const a = get(r, "applied");
    if (d === "reject") {
      if (!(has(r, "applied") && a === null)) add("REJECT_APPLIED");
    } else if (!isObj(a)) {
      add("APPLIED_NOT_OBJECT");
    } else {
      const lin = get(a, "linear_mps"), ang = get(a, "angular_radps"), tgt = get(a, "target");
      if (d === "stop") {
        if ((typeof lin === "number" && lin !== 0) || (typeof ang === "number" && ang !== 0)) add("STOP_WITH_MOTION");
      } else {
        if (typeof lin === "number" && typeof maxSpeed === "number" && Math.abs(lin) > maxSpeed) add("SPEED_EXCEEDED");
        if (typeof ang === "number" && typeof maxTurn === "number" && Math.abs(ang) > maxTurn) add("TURN_EXCEEDED");
        if (isPoint(tgt)) {
          if (keepIn && !insideOrOn(tgt, keepIn)) add("OUTSIDE_KEEP_IN");
          for (const poly of keepOut) if (insideOrOn(tgt, poly)) add("INSIDE_KEEP_OUT");
        }
        if (d === "allow" && canon(a) !== canon(has(r, "cmd") ? r.cmd : null)) add("ALLOW_MODIFIED");
      }
      for (const k of Object.keys(a)) {
        const v = a[k];
        const judged = k === "kind" || ((k === "linear_mps" || k === "angular_radps") && typeof v === "number") || (k === "target" && d !== "stop" && isPoint(v));
        if (!judged) unchecked.add(k);
      }
    }
    if (d !== "allow" && !nonEmpty(get(r, "reason"))) add("MISSING_REASON");
  }
  for (const field of [...unchecked].sort()) findings.push({ seq: null, code: "UNCHECKED_FIELDS", field });
  return { findings };
}
