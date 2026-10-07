import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GENESIS, canon, hashOf, run } from "./lib.ts";

const here = import.meta.dirname;
const drive = (input: string) => {
  const r = spawnSync(process.execPath, ["driver.ts"], { cwd: here, input });
  return { status: r.status, out: r.stdout.toString("utf8") };
};
const cj = (text: string) => canon(JSON.parse(text));
const err = (op: string, input: any) => {
  try { run(op, input); } catch (e: any) { return e.code; }
  return null;
};
const env = () => ({
  envelope_version: "0.1", machine: { id: "m", class: "c" }, level: "A1",
  workspace: { frame: "w", keep_in: [[0, 0], [10, 0], [10, 10], [0, 10]], keep_out: [[[4, 4], [6, 4], [6, 6], [4, 6]]] },
  motion: { max_speed_mps: 1, max_turn_radps: 2 },
  stop: { category: 1, max_time_ms: 100, max_distance_m: 0 },
  heartbeat: { model_timeout_ms: 10, gate_timeout_ms: 10, on_loss: "stop" },
  authority: { required_for: ["motion"] },
});
const codes = (v: any) => v.errors.map((e: any) => e.path + ":" + e.code);

test("REQ-CJ canonical examples", () => {
  assert.equal(cj('{"b":1,"a":2,"c":3}'), '{"a":2,"b":1,"c":3}');
  assert.equal(cj('{"x":50.0,"y":-0.0,"z":5e1}'), '{"x":50,"y":0,"z":50}');
  assert.equal(cj("[1e21,1e-7,1e16,0.000001,0.1]"), "[1e+21,1e-7,10000000000000000,0.000001,0.1]");
  assert.equal(cj("[123456789012345680000,9007199254740993,1.5e-10]"), "[123456789012345680000,9007199254740992,1.5e-10]");
  assert.equal(cj('["\\u001f","\\u0008\\t\\n\\f\\r","\\"\\\\","/\\u007f\\u2028"]'), '["\\u001f","\\b\\t\\n\\f\\r","\\"\\\\","/\x7f "]');
  assert.equal(cj('{"\\ue000":1,"\\ud83d\\ude00":2}'), '{"😀":2,"":1}');
  assert.equal(cj('{"b":0,"10":1,"9":2,"":3}'), '{"":3,"10":1,"9":2,"b":0}');
  assert.equal(cj('{"ok":true,"no":false,"none":null,"list":[],"obj":{}}'), '{"list":[],"no":false,"none":null,"obj":{},"ok":true}');
});

test("REQ-CJ-004/005 errors and REQ-CJ-006 base64", () => {
  assert.equal(err("canonical", { value: [1e400] }), "non_finite_number");
  assert.equal(err("canonical", { value: { "\ud800": 1 } }), "invalid_string");
  assert.equal(err("canonical", { value: "\udc00x" }), "invalid_string");
  assert.equal(run("canonical", { value: { b: 1, a: "é" } }), Buffer.from('{"a":"é","b":1}').toString("base64"));
});

test("REQ-HA hashes", () => {
  const h = "sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862";
  assert.equal(run("envelopeHash", { envelope: { signature: "x", a: 1 } }), h);
  assert.equal(run("recordHash", { record: { a: 1, hash: "y" } }), h);
  assert.notEqual(run("envelopeHash", { envelope: { n: { signature: "x" } } }), run("envelopeHash", { envelope: { n: {} } }));
});

test("REQ-EV validation", () => {
  assert.deepEqual(run("validateEnvelope", { envelope: env() }), { valid: true, errors: [] });
  const t = (f: (e: any) => void) => { const e = env(); f(e); return codes(run("validateEnvelope", { envelope: e })); };
  assert.deepEqual(t((e) => (e.heartbeat.on_loss = "continue")), ["/heartbeat/on_loss:invalid_value"]);
  assert.deepEqual(t((e) => (e.level = "L3")), ["/level:invalid_value"]);
  assert.deepEqual(t((e) => delete e.stop), ["/stop:required"]);
  assert.deepEqual(t((e) => (e.motion.max_sped_mps = 5)), ["/motion/max_sped_mps:unknown_member"]);
  assert.deepEqual(codes(run("validateEnvelope", { envelope: [1] })), [":type"]);
  assert.deepEqual(t((e) => (e.envelope_version = "0.1\n")), ["/envelope_version:invalid_value"]);
  assert.deepEqual(t((e) => (e.signature = "ed-1:abc")), []);
  assert.deepEqual(t((e) => (e.signature = "Ed:abc")), ["/signature:invalid_value"]);
  assert.deepEqual(t((e) => (e.signature = "ed:a\nb")), ["/signature:invalid_value"]);
  assert.deepEqual(t((e) => (e.signature = "ed:a ")), ["/signature:invalid_value"]);
  assert.deepEqual(t((e) => (e.signature = "ed:")), ["/signature:invalid_value"]);
  assert.deepEqual(t((e) => (e.signature = "ed:a:b é")), []);
  assert.deepEqual(t((e) => (e.stop.max_time_ms = 300.5)), ["/stop/max_time_ms:type"]);
  assert.deepEqual(t((e) => (e.stop.max_time_ms = 300.0)), []);
  assert.deepEqual(t((e) => (e.stop.category = 3)), ["/stop/category:invalid_value"]);
  assert.deepEqual(t((e) => (e.motion.max_speed_mps = true)), ["/motion/max_speed_mps:type"]);
  assert.deepEqual(t((e) => (e.motion.max_speed_mps = 0)), ["/motion/max_speed_mps:invalid_value"]);
  assert.deepEqual(t((e) => (e.workspace.keep_in = [[0, 0], [1]])), ["/workspace/keep_in:invalid_value", "/workspace/keep_in/1:invalid_value"]);
  assert.deepEqual(t((e) => (e.workspace.z_range_m = ["a", 1, 2])), ["/workspace/z_range_m:invalid_value", "/workspace/z_range_m/0:type"]);
  assert.deepEqual(t((e) => (e.workspace.keep_out = [[[0, 0], [1, 1]]])), ["/workspace/keep_out/0:invalid_value"]);
  assert.deepEqual(t((e) => (e.authority.required_for = ["a", "a", "a", 5])).sort(),["/authority/required_for:invalid_value", "/authority/required_for/3:type"].sort());
  assert.deepEqual(t((e) => (e["a/b~"] = 1)), ["/a~1b~0:unknown_member"]);
  assert.deepEqual(t((e) => (e.proximity = [{ when: { human_within_m: 1 }, action: 5 }])), ["/proximity/0/action:type"]);
  assert.deepEqual(t((e) => (e.proximity = [{ when: { human_within_m: 1 } }, { when: { human_within_m: 1 }, action: "stop", max_speed_mps: 0 }, { when: { human_within_m: 1 }, max_speed_mps: 0 }])),
    ["/proximity/0:invalid_value", "/proximity/1:invalid_value"]);
  assert.deepEqual(t((e) => (e.machine = { id: "", class: "c" })), ["/machine/id:invalid_value"]);
});

const mk = (n: number) => {
  const recs: any[] = [];
  for (let i = 0; i < n; i++) {
    const r: any = { seq: i, prev: i ? recs[i - 1].hash : GENESIS, decision: "reject", applied: null, reason: "r" };
    r.hash = hashOf(r, "hash");
    recs.push(r);
  }
  return recs;
};
const vc = (records: any, expectedHead?: string) => run("verifyChain", expectedHead === undefined ? { records } : { records, expectedHead });

test("REQ-CH chain", () => {
  const c = mk(3);
  assert.deepEqual(run("verifyChain", { records: c }), { findings: [], head: c[2].hash, tail: "unverified" });
  assert.deepEqual(run("verifyChain", { records: [] }), { findings: [], head: GENESIS, tail: "unverified" });
  assert.deepEqual(vc(c.slice(0, 2)).findings, []);
  assert.equal(vc(c.slice(0, 2)).tail, "unverified");
  assert.deepEqual(vc(c, c[2].hash), { findings: [], head: c[2].hash, tail: "anchored" });
  assert.deepEqual(vc(c.slice(0, 2), c[2].hash).findings, [{ seq: null, code: "HEAD_MISMATCH" }]);
  assert.deepEqual(vc(c.slice(1)).findings.map((f: any) => f.code), ["BAD_GENESIS", "PREV_MISMATCH"]);
  const g = [c[0], { ...c[2] }];
  assert.deepEqual(vc(g).findings.map((f: any) => f.code), ["SEQ_GAP", "PREV_MISMATCH"]);
  const t = [c[0], { ...c[1], reason: "x" }];
  assert.deepEqual(vc(t).findings, [{ seq: 1, code: "HASH_MISMATCH" }]);
  assert.equal(err("verifyChain", { records: [{ seq: 0, prev: "a" }] }), "bad_request");
  assert.equal(err("verifyChain", { records: [{ seq: -1, prev: "a", hash: "b" }] }), "bad_request");
  assert.equal(err("verifyChain", { records: [{ seq: 1.5, prev: "a", hash: "b" }] }), "bad_request");
  assert.equal(err("verifyChain", { records: [], expectedHead: 5 }), "bad_request");
  assert.equal(err("verifyChain", { records: [[]] }), "bad_request");
  assert.equal(err("verifyChain", { records: [{ seq: 0, prev: "a", hash: "b", x: 1e400 }] }), "non_finite_number");
});

test("REQ-AA authority", () => {
  const e = env();
  const recs = [
    { seq: 0, decision: "allow" },
    { seq: 1, decision: "clamp", principal: "p", authority: "" },
    { seq: 2, decision: "allow", cmd: { kind: "grip" }, principal: "", authority: 5 },
    { seq: 3, decision: "reject", principal: "" },
    { seq: 4, decision: "allow", principal: "p", authority: "a", cmd: null },
    { seq: 5, decision: "allow", cmd: { kind: 5 } },
  ];
  assert.deepEqual(run("auditAuthority", { records: recs, envelope: e }).findings, [
    { seq: 0, code: "NO_PRINCIPAL" }, { seq: 0, code: "NO_AUTHORITY" }, { seq: 1, code: "NO_AUTHORITY" },
    { seq: 5, code: "NO_PRINCIPAL" }, { seq: 5, code: "NO_AUTHORITY" },
  ]);
  const e2: any = env(); e2.authority = { required_for: ["grip", 3] };
  assert.deepEqual(run("auditAuthority", { records: recs, envelope: e2 }).findings.map((f: any) => f.seq), [2, 2]);
  assert.deepEqual(run("auditAuthority", { records: recs, envelope: { authority: 3 } }).findings, []);
});

test("REQ-RP replay", () => {
  const e: any = env();
  const H = run("envelopeHash", { envelope: e });
  const rp = (r: any, envl: any = e) => run("replay", { records: [{ seq: 0, envelope: H, ...r }], envelope: envl }).findings.map((f: any) => f.code + (f.field ? ":" + f.field : ""));
  assert.deepEqual(rp({ decision: "allow", cmd: { linear_mps: 0.5 }, applied: { linear_mps: 0.5 } }), []);
  assert.deepEqual(rp({ envelope: "x", decision: "bogus" }), ["ENVELOPE_MISMATCH", "UNKNOWN_DECISION"]);
  assert.deepEqual(rp({ decision: "reject", reason: "r" }), ["REJECT_APPLIED"]);
  assert.deepEqual(rp({ decision: "reject", applied: 0 }), ["REJECT_APPLIED", "MISSING_REASON"]);
  assert.deepEqual(rp({ decision: "reject", applied: null, reason: "r" }), []);
  assert.deepEqual(rp({ decision: "allow", applied: [] }), ["APPLIED_NOT_OBJECT"]);
  assert.deepEqual(rp({ decision: "stop", applied: 3 }), ["APPLIED_NOT_OBJECT", "MISSING_REASON"]);
  assert.deepEqual(rp({ decision: "stop", reason: "r", applied: { linear_mps: 0, angular_radps: 0.1, target: [1, 1] } }), ["STOP_WITH_MOTION", "UNCHECKED_FIELDS:target"]);
  assert.deepEqual(rp({ decision: "clamp", reason: "r", applied: { linear_mps: -1.5, angular_radps: 1e400 } }), ["SPEED_EXCEEDED", "TURN_EXCEEDED"]);
  assert.deepEqual(rp({ decision: "clamp", reason: "r", applied: { linear_mps: "0.4", target: [1], z_m: 1, gripper: 1, kind: "x" } }), ["UNCHECKED_FIELDS:gripper", "UNCHECKED_FIELDS:linear_mps", "UNCHECKED_FIELDS:target", "UNCHECKED_FIELDS:z_m"]);
  assert.deepEqual(rp({ decision: "clamp", reason: "r", applied: { target: [11, 5] } }), ["OUTSIDE_KEEP_IN"]);
  assert.deepEqual(rp({ decision: "clamp", reason: "r", applied: { target: [10, 10] } }), []);
  assert.deepEqual(rp({ decision: "clamp", reason: "r", applied: { target: [5, 5] } }), ["INSIDE_KEEP_OUT"]);
  assert.deepEqual(rp({ decision: "clamp", reason: "r", applied: { target: [4, 5] } }), ["INSIDE_KEEP_OUT"]);
  assert.deepEqual(rp({ decision: "clamp", reason: "r", applied: { target: [6.5, 5] } }), []);
  assert.deepEqual(rp({ decision: "allow", cmd: { linear_mps: 0.5 }, applied: { linear_mps: 0.6 } }), ["ALLOW_MODIFIED"]);
  assert.deepEqual(rp({ decision: "allow", applied: { linear_mps: 0.5 } }), ["ALLOW_MODIFIED"]);
  assert.deepEqual(rp({ decision: "allow", cmd: { a: 1, b: 2 }, applied: { b: 2, a: 1.0 }, }), ["UNCHECKED_FIELDS:a", "UNCHECKED_FIELDS:b"]);
  const loose = { motion: { max_speed_mps: "0.1" }, workspace: { keep_in: [[0, 0], [1, 1]], keep_out: [[[0, 0]], 5] } };
  const Hl = run("envelopeHash", { envelope: loose });
  assert.deepEqual(rp({ envelope: Hl, decision: "allow", cmd: { linear_mps: 9, target: [5, 5] }, applied: { linear_mps: 9, target: [5, 5] } }, loose), []);
  assert.equal(err("replay", { records: [], envelope: { a: 1e400 } }), "non_finite_number");
  assert.equal(err("replay", { records: [{ seq: 0, decision: "allow", applied: { a: 1e400 }, cmd: null }], envelope: {} }), "non_finite_number");
  assert.equal(err("replay", { records: [{ seq: 0, decision: "clamp", applied: { a: 1e400 } }], envelope: {} }), null);
  assert.equal(err("replay", { records: [{ seq: 0 }], envelope: [] }), "bad_request");
});

test("REQ-IF driver protocol", () => {
  const lines = [
    '{"id":"a","op":"canonical","input":{"value":{"b":1,"a":2}}}\r',
    "",
    "  \t\r",
    "not json",
    "[1]",
    '{"id":5,"op":"canonical"}',
    '{"id":"b","op":"nope"}',
    '{"id":"c","op":"canonical","input":[]}',
    '{"id":"d","op":"canonical","input":{"value":NaN}}',
    '{"id":"e","op":"canonical","input":{"value":1e400}}',
    '{"id":"f","op":"canonical","input":{"value":"\\ud800"},"extra":1}',
    '{"id":"g","op":"replay","input":{"records":[],"envelope":{}}}',
    '{"id":"h ","op":"validateEnvelope","input":{"envelope":null}}',
  ];
  const { status, out } = drive(lines.join("\n") + "\n");
  assert.equal(status, 0);
  assert.ok(out.endsWith("\n") && !out.includes("\r"));
  const got = out.split("\n").slice(0, -1).map((l) => JSON.parse(l));
  assert.deepEqual(got, [
    { id: "a", result: Buffer.from('{"a":2,"b":1}').toString("base64") },
    { id: null, error: "bad_request" },
    { id: null, error: "bad_request" },
    { id: null, error: "bad_request" },
    { id: "b", error: "unknown_op" },
    { id: "c", error: "bad_request" },
    { id: null, error: "bad_request" },
    { id: "e", error: "non_finite_number" },
    { id: "f", error: "invalid_string" },
    { id: "g", result: { findings: [] } },
    { id: "h ", result: { valid: false, errors: [{ path: "", code: "type" }] } },
  ]);
  assert.equal(drive("").out, "");
  assert.equal(drive('{"id":"z","op":"recordHash","input":{"record":{}}}').out.split("\n").length, 2);
});

test("REQ-CL command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-"));
  const e: any = env();
  const H = run("envelopeHash", { envelope: e });
  const recs: any[] = [];
  for (let i = 0; i < 2; i++) {
    const r: any = { seq: i, prev: i ? recs[i - 1].hash : GENESIS, envelope: H, decision: "allow", cmd: { gripper: 1 }, applied: { gripper: 1 }, principal: "p", authority: "a" };
    r.hash = hashOf(r, "hash");
    recs.push(r);
  }
  const w = (n: string, v: any) => { const p = join(dir, n); writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v)); return p; };
  const chain = w("c.json", recs), envf = w("e.json", e);
  const cli = (...a: string[]) => { const r = spawnSync(process.execPath, ["verify.ts", ...a], { cwd: here }); return { s: r.status, o: r.stdout.toString() }; };
  let r = cli("verify", chain, envf, "--json");
  assert.equal(r.s, 0);
  assert.deepEqual(JSON.parse(r.o), { ok: true, records: 2, tail: "unverified", envelope: { valid: true, errors: [] }, findings: [{ seq: null, code: "UNCHECKED_FIELDS", field: "gripper" }] });
  assert.ok(r.o.endsWith("}\n") && r.o.split("\n").length === 2);
  r = cli("verify", chain, "--head", recs[1].hash, "--json");
  assert.deepEqual(JSON.parse(r.o), { ok: true, records: 2, tail: "anchored", envelope: null, findings: [] });
  r = cli("verify", "--json", "--head", "sha256:bad", chain);
  assert.equal(r.s, 1);
  assert.deepEqual(JSON.parse(r.o).findings, [{ seq: null, code: "HEAD_MISMATCH" }]);
  assert.equal(cli("verify", chain, w("bad.json", { ...e, level: "L9" })).s, 1);
  assert.equal(cli().s, 2);
  assert.equal(cli("check", chain).s, 2);
  assert.equal(cli("verify").s, 2);
  assert.equal(cli("verify", chain, "--bogus").s, 2);
  assert.equal(cli("verify", chain, "--head").s, 2);
  assert.equal(cli("verify", chain, envf, chain).s, 2);
  assert.equal(cli("verify", "/nonexistent/x.json", "--bogus").s, 2);
  assert.equal(cli("verify", join(dir, "missing.json")).s, 3);
  assert.equal(cli("verify", w("nj.json", "[NaN]")).s, 3);
  assert.equal(cli("verify", w("obj.json", {})).s, 3);
  assert.equal(cli("verify", w("noprev.json", [{ seq: 0 }])).s, 3);
  assert.equal(cli("verify", chain, w("arr.json", [])).s, 3);
  assert.equal(cli("verify", chain, w("inf.json", '{"a":1e400}')).s, 3);
});
