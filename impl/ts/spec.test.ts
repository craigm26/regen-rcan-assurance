import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "./driver.ts";
import { canon, envelopeHash, recordHash, GENESIS } from "./lib.ts";

const dir = import.meta.dirname;
const call = (op: string, input: any) => JSON.parse(handle(JSON.stringify({ id: "t", op, input })));
const canonText = (jsonText: string) => Buffer.from(call("canonical", { value: JSON.parse(jsonText) }).result, "base64").toString("utf8");

test("REQ-CJ-001..003 canonical examples", () => {
  assert.equal(canonText('{"b":1,"a":2,"c":3}'), '{"a":2,"b":1,"c":3}');
  assert.equal(canonText('{"x":50.0,"y":-0.0,"z":5e1}'), '{"x":50,"y":0,"z":50}');
  assert.equal(canonText("[1e21,1e-7,1e16,0.000001,0.1]"), "[1e+21,1e-7,10000000000000000,0.000001,0.1]");
  assert.equal(canonText("[123456789012345680000,9007199254740993,1.5e-10]"), "[123456789012345680000,9007199254740992,1.5e-10]");
  assert.equal(canonText('{"name":"Café ☕","path":"a/b"}'), '{"name":"Café ☕","path":"a/b"}');
  assert.equal(canonText('["\\u001f","\\u0008\\t\\n\\f\\r","\\"\\\\"]'), '["\\u001f","\\b\\t\\n\\f\\r","\\"\\\\"]');
  assert.equal(canonText('{"\\ue000":1,"\\ud83d\\ude00":2}'), '{"😀":2,"":1}');
  assert.equal(canonText('{"b":0,"10":1,"9":2,"":3}'), '{"":3,"10":1,"9":2,"b":0}');
  assert.equal(canonText('{"ok":true,"no":false,"none":null,"list":[],"obj":{}}'), '{"list":[],"no":false,"none":null,"obj":{},"ok":true}');
  assert.equal(canonText('"\\u007f\\u2028/"'), '"\u007f /"');
});

test("REQ-CJ-004/005, REQ-IF-007 canonical errors", () => {
  assert.deepEqual(JSON.parse(handle('{"id":"a","op":"canonical","input":{"value":[1e400]}}')), { id: "a", error: "non_finite_number" });
  assert.deepEqual(JSON.parse(handle('{"id":"a","op":"canonical","input":{"value":"\\ud800"}}')), { id: "a", error: "invalid_string" });
  assert.deepEqual(JSON.parse(handle('{"id":"a","op":"canonical","input":{"value":{"\\udc00":1}}}')), { id: "a", error: "invalid_string" });
  assert.deepEqual(call("canonical", { value: { a: "😀" } }).result, Buffer.from('{"a":"😀"}').toString("base64"));
});

test("REQ-CJ-006 base64", () => {
  assert.equal(call("canonical", { value: null }).result, "bnVsbA==");
});

test("REQ-HA-001..003 hashes", () => {
  const h = "sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862";
  assert.equal(call("envelopeHash", { envelope: { signature: "x", a: 1 } }).result, h);
  assert.equal(call("recordHash", { record: { a: 1, hash: "y" } }).result, h);
  assert.equal(envelopeHash({ a: 1, n: { signature: 1 } }), envelopeHash({ n: { signature: 1 }, a: 1, signature: "q" }));
  assert.notEqual(envelopeHash({ n: { signature: 1 } }), envelopeHash({ n: {} }));
});

test("REQ-IF-002..007 driver protocol", () => {
  const input = '{"id":"1","op":"canonical","input":{"value":1}}\r\n   \t\r\n\n{"id":5,"op":"x"}\nnot json\n[]\n' +
    '{"id":"2"}\n{"id":"3","op":"nope","input":{}}\n{"id":"4","op":"canonical"}\n{"id":"5","op":"canonical","input":{}}\n' +
    '{"id":"6","op":"canonical","input":{"value":NaN}}\n{"id":"7","op":"canonical","input":{"value":50.0},"extra":1}';
  const r = spawnSync("node", ["driver.ts"], { cwd: dir, input });
  assert.equal(r.status, 0);
  const out = r.stdout.toString("utf8");
  assert.ok(!out.includes("\r") && out.endsWith("\n"));
  assert.deepEqual(out.trimEnd().split("\n").map((l) => JSON.parse(l)), [
    { id: "1", result: "MQ==" },
    { id: null, error: "bad_request" },
    { id: null, error: "bad_request" },
    { id: null, error: "bad_request" },
    { id: "2", error: "unknown_op" },
    { id: "3", error: "unknown_op" },
    { id: "4", error: "bad_request" },
    { id: "5", error: "bad_request" },
    { id: null, error: "bad_request" },
    { id: "7", result: "NTA=" },
  ]);
  // lone CR inside a line is whitespace, not a separator
  const r2 = spawnSync("node", ["driver.ts"], { cwd: dir, input: '{"id":"a",\r"op":"canonical","input":{"value":1}}\n' });
  assert.equal(r2.stdout.toString(), '{"id":"a","result":"MQ=="}\n');
});

const goodEnv = () => ({
  envelope_version: "0.1", machine: { id: "m", class: "c" }, level: "A2",
  workspace: { frame: "map", keep_in: [[0, 0], [10, 0], [10, 10], [0, 10]], keep_out: [[[4, 4], [6, 4], [6, 6], [4, 6]]] },
  motion: { max_speed_mps: 1, max_turn_radps: 2 },
  stop: { category: 1, max_time_ms: 300.0, max_distance_m: 0 },
  heartbeat: { model_timeout_ms: 500, gate_timeout_ms: 100, on_loss: "stop" },
  authority: { required_for: ["motion"], resolver: "local" },
  signature: "ed25519:abc def",
});
const errs = (e: any) => call("validateEnvelope", { envelope: e }).result;
const mut = (f: (e: any) => void) => { const e = goodEnv(); f(e); return errs(e); };

test("REQ-EV-001..007 envelope validation", () => {
  assert.deepEqual(errs(goodEnv()), { valid: true, errors: [] });
  assert.deepEqual(mut((e) => { e.heartbeat.on_loss = "continue"; }).errors, [{ path: "/heartbeat/on_loss", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.level = "L3"; }).errors, [{ path: "/level", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { delete e.stop; }).errors, [{ path: "/stop", code: "required" }]);
  assert.deepEqual(mut((e) => { e.motion.max_sped_mps = 5; }).errors, [{ path: "/motion/max_sped_mps", code: "unknown_member" }]);
  assert.deepEqual(errs([1]), { valid: false, errors: [{ path: "", code: "type" }] });
  assert.deepEqual(mut((e) => { e.stop.max_time_ms = 300.5; }).errors, [{ path: "/stop/max_time_ms", code: "type" }]);
  assert.deepEqual(mut((e) => { e.machine.mass_kg = true; }).errors, [{ path: "/machine/mass_kg", code: "type" }]);
  assert.deepEqual(mut((e) => { e.envelope_version = "0.1\n"; }).errors, [{ path: "/envelope_version", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.envelope_version = "1.0"; }).errors, [{ path: "/envelope_version", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.signature = "ED:x"; }).errors, [{ path: "/signature", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.signature = "a:b "; }).errors, [{ path: "/signature", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.stop.category = 3; }).errors, [{ path: "/stop/category", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.stop.max_distance_m = -1; }).errors, [{ path: "/stop/max_distance_m", code: "invalid_value" }]);
  // pointer escaping, closed nested objects
  assert.deepEqual(mut((e) => { e.machine["a/b~c"] = 1; }).errors, [{ path: "/machine/a~1b~0c", code: "unknown_member" }]);
  // points and polygons
  assert.deepEqual(mut((e) => { e.workspace.keep_in = [[1], [0, 0], ["a", 1, 2]]; }).errors.sort((a: any, b: any) => (a.path + a.code < b.path + b.code ? -1 : 1)), [
    { path: "/workspace/keep_in/0", code: "invalid_value" },
    { path: "/workspace/keep_in/2/0", code: "type" },
    { path: "/workspace/keep_in/2", code: "invalid_value" },
  ]);
  assert.deepEqual(mut((e) => { e.workspace.keep_in = [[0, 0], [1, 1]]; }).errors, [{ path: "/workspace/keep_in", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.workspace.z_range_m = [5, -5]; }).errors, []);
  assert.deepEqual(mut((e) => { e.workspace.z_range_m = [1]; }).errors, [{ path: "/workspace/z_range_m", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.workspace.keep_out = [5]; }).errors, [{ path: "/workspace/keep_out/0", code: "type" }]);
  // proximity
  assert.deepEqual(mut((e) => { e.proximity = [{ when: { human_within_m: 2 }, max_speed_mps: 0 }, { when: { human_within_m: 1 }, action: "stop" }]; }).errors, []);
  assert.deepEqual(mut((e) => { e.proximity = [{ when: { human_within_m: 2 } }]; }).errors, [{ path: "/proximity/0", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.proximity = [{ when: { human_within_m: 2 }, action: "stop", max_speed_mps: 1 }]; }).errors, [{ path: "/proximity/0", code: "invalid_value" }]);
  assert.deepEqual(mut((e) => { e.proximity = [{ when: { human_within_m: 0, x: 1 }, action: "stop" }]; }).errors.length, 2);
  // uniqueness
  assert.deepEqual(mut((e) => { e.authority.required_for = ["a", "a", "a", 1, 1]; }).errors.sort((a: any, b: any) => a.path.localeCompare(b.path)), [
    { path: "/authority/required_for", code: "invalid_value" },
    { path: "/authority/required_for/3", code: "type" },
    { path: "/authority/required_for/4", code: "type" },
  ]);
  // all errors reported
  assert.equal(mut((e) => { e.level = "x"; delete e.motion; e.extra = 1; }).errors.length, 3);
});

const mkChain = (n: number, extra: (i: number) => any = () => ({})) => {
  const out: any[] = [];
  let prev = GENESIS;
  for (let i = 0; i < n; i++) {
    const r: any = { seq: i, prev, ...extra(i) };
    r.hash = recordHash(r);
    prev = r.hash;
    out.push(r);
  }
  return out;
};
const codes = (f: any[]) => f.map((x) => `${x.seq}:${x.code}`);

test("REQ-CH-001..005 verifyChain", () => {
  const c = mkChain(3);
  assert.deepEqual(call("verifyChain", { records: c }).result, { findings: [], head: c[2].hash, tail: "unverified" });
  assert.deepEqual(call("verifyChain", { records: [] }).result, { findings: [], head: GENESIS, tail: "unverified" });
  // truncated chain still verifies, tail unverified (REQ-CH-004)
  assert.equal(call("verifyChain", { records: c.slice(0, 2) }).result.tail, "unverified");
  assert.deepEqual(call("verifyChain", { records: c, expectedHead: c[2].hash }).result, { findings: [], head: c[2].hash, tail: "anchored" });
  assert.deepEqual(call("verifyChain", { records: c.slice(0, 2), expectedHead: c[2].hash }).result.findings, [{ seq: null, code: "HEAD_MISMATCH" }]);
  // order of findings per record
  const bad = [{ ...c[1] }];
  assert.deepEqual(codes(call("verifyChain", { records: bad }).result.findings), ["1:BAD_GENESIS", "1:PREV_MISMATCH"]);
  const g = [c[0], { ...c[2] }];
  assert.deepEqual(codes(call("verifyChain", { records: g }).result.findings), ["2:SEQ_GAP", "2:PREV_MISMATCH"]);
  const t = [c[0], { ...c[1], x: 1 }, c[2]];
  assert.deepEqual(codes(call("verifyChain", { records: t }).result.findings), ["1:HASH_MISMATCH"]);
  // shape errors
  for (const records of [{}, [1], [{ seq: -1, prev: "", hash: "" }], [{ seq: 1.5, prev: "", hash: "" }], [{ seq: 0, prev: 1, hash: "" }], [{ seq: 0, prev: "" }]])
    assert.equal(call("verifyChain", { records }).error, "bad_request");
  assert.equal(call("verifyChain", { records: [], expectedHead: null }).error, "bad_request");
  assert.equal(JSON.parse(handle('{"id":"x","op":"verifyChain","input":{"records":[{"seq":0,"prev":"p","hash":"x","v":1e400}]}}')).error, "non_finite_number");
  assert.equal(call("replay", { records: [{ seq: "0" }], envelope: {} }).error, "bad_request");
  assert.equal(call("auditAuthority", { records: [{ seq: 0 }], envelope: [] }).error, "bad_request");
  assert.deepEqual(call("auditAuthority", { records: [{ seq: 0 }], envelope: {} }).result, { findings: [] });
});

test("REQ-AA-001/002 auditAuthority", () => {
  const env = { authority: { required_for: ["motion", "grip", 5] } };
  const recs = [
    { seq: 0, decision: "allow", cmd: { kind: "motion" } },
    { seq: 1, decision: "clamp", cmd: null, principal: "p", authority: "" },
    { seq: 2, decision: "allow", cmd: { kind: "grip" }, principal: "p", authority: "a" },
    { seq: 3, decision: "reject", cmd: {} },
    { seq: 4, decision: "allow", cmd: { kind: "other" } },
    { seq: 5, decision: "allow", cmd: { kind: 5 }, principal: 1, authority: true },
    { seq: 6, decision: "allow", cmd: { kind: "grip" }, principal: "", authority: null },
  ];
  assert.deepEqual(codes(call("auditAuthority", { records: recs, envelope: env }).result.findings),
    ["0:NO_PRINCIPAL", "0:NO_AUTHORITY", "1:NO_AUTHORITY", "5:NO_PRINCIPAL", "5:NO_AUTHORITY", "6:NO_PRINCIPAL", "6:NO_AUTHORITY"]);
  for (const envelope of [{}, { authority: 1 }, { authority: { required_for: "motion" } }])
    assert.deepEqual(call("auditAuthority", { records: recs, envelope }).result.findings, []);
});

test("REQ-RP-001..005 replay", () => {
  const env: any = goodEnv();
  const H = envelopeHash(env);
  const rec = (seq: number, o: any) => ({ seq, envelope: H, ...o });
  const rp = (records: any[], e: any = env) => call("replay", { records, envelope: e }).result.findings;
  const f = (seq: number | null, code: string, field?: string) => (field === undefined ? { seq, code } : { seq, code, field });

  assert.deepEqual(rp([rec(0, { decision: "allow", cmd: { linear_mps: 0.5 }, applied: { linear_mps: 0.5 } })]), []);
  assert.deepEqual(rp([{ seq: 0, decision: "reject", applied: null, reason: "r" }]), [f(0, "ENVELOPE_MISMATCH")]);
  assert.deepEqual(rp([rec(1, { decision: "weird" })]), [f(1, "UNKNOWN_DECISION")]);
  // reject
  assert.deepEqual(rp([rec(0, { decision: "reject", reason: "r" })]), [f(0, "REJECT_APPLIED")]);
  assert.deepEqual(rp([rec(0, { decision: "reject", applied: {}, reason: "" })]), [f(0, "REJECT_APPLIED"), f(0, "MISSING_REASON")]);
  assert.deepEqual(rp([rec(0, { decision: "reject", applied: null, reason: "r" })]), []);
  // applied not object; reason still checked
  assert.deepEqual(rp([rec(0, { decision: "stop", applied: [] })]), [f(0, "APPLIED_NOT_OBJECT"), f(0, "MISSING_REASON")]);
  assert.deepEqual(rp([rec(0, { decision: "allow", applied: null })]), [f(0, "APPLIED_NOT_OBJECT")]);
  // stop
  assert.deepEqual(rp([rec(0, { decision: "stop", applied: { linear_mps: 0.1, angular_radps: 1 }, reason: "r" })]), [f(0, "STOP_WITH_MOTION")]);
  assert.deepEqual(rp([rec(0, { decision: "stop", applied: { linear_mps: 0, angular_radps: 0, target: [1, 1] }, reason: "r" })]), [f(null, "UNCHECKED_FIELDS", "target")]);
  // bounds
  assert.deepEqual(rp([rec(0, { decision: "clamp", applied: { linear_mps: -1.5, angular_radps: 3 }, reason: "r" })]), [f(0, "SPEED_EXCEEDED"), f(0, "TURN_EXCEEDED")]);
  assert.deepEqual(rp([rec(0, { decision: "clamp", applied: { linear_mps: 1, angular_radps: 2 }, reason: "r" })]), []);
  const e3: any = { ...goodEnv(), motion: { max_speed_mps: "1" } };
  assert.deepEqual(rp([{ seq: 0, envelope: envelopeHash(e3), decision: "clamp", applied: { linear_mps: 99 }, reason: "r" }], e3), []);
  // geometry: boundary in for keep-in, boundary in for keep-out
  const tgt = (t: any) => rp([rec(0, { decision: "clamp", applied: { target: t }, reason: "r" })]);
  assert.deepEqual(tgt([0, 0]), []);
  assert.deepEqual(tgt([10, 5]), []);
  assert.deepEqual(tgt([5, 5]), [f(0, "INSIDE_KEEP_OUT")]);
  assert.deepEqual(tgt([4, 5]), [f(0, "INSIDE_KEEP_OUT")]);
  assert.deepEqual(tgt([4, 4]), [f(0, "INSIDE_KEEP_OUT")]);
  assert.deepEqual(tgt([3.9, 5]), []);
  assert.deepEqual(tgt([11, 5]), [f(0, "OUTSIDE_KEEP_IN")]);
  assert.deepEqual(tgt([-1, 5]), [f(0, "OUTSIDE_KEEP_IN")]);
  const e2: any = { ...goodEnv(), workspace: { ...env.workspace, keep_out: [[[0, 0], [1, 1]], [[4, 4], [6, 4], [6, 6], [4, 6]], [[4.5, 4.5], [5, 4.5], [5, 5]], 7] } };
  const H2 = envelopeHash(e2);
  assert.deepEqual(rp([{ seq: 0, envelope: H2, decision: "allow", cmd: { target: [5, 5] }, applied: { target: [5, 5] } }], e2), [f(0, "INSIDE_KEEP_OUT"), f(0, "INSIDE_KEEP_OUT")]);
  // allow modified
  assert.deepEqual(rp([rec(0, { decision: "allow", cmd: { linear_mps: 0.5 }, applied: { linear_mps: 0.6 } })]), [f(0, "ALLOW_MODIFIED")]);
  assert.deepEqual(rp([rec(0, { decision: "allow", applied: {} })]), [f(0, "ALLOW_MODIFIED")]);
  assert.deepEqual(rp([rec(0, { decision: "allow", cmd: null, applied: {} })]), [f(0, "ALLOW_MODIFIED")]);
  assert.deepEqual(rp([rec(0, { decision: "allow", cmd: { a: 1.0, b: 2 }, applied: { b: 2, a: 1 } })]), [f(null, "UNCHECKED_FIELDS", "a"), f(null, "UNCHECKED_FIELDS", "b")]);
  // allow does not need reason
  assert.deepEqual(rp([rec(0, { decision: "allow", cmd: {}, applied: {} })]), []);
  // unchecked fields: sorted, distinct, UTF-16 order
  const u = rp([
    rec(0, { decision: "allow", cmd: {}, applied: { z_m: 1, "": 1, gripper: 1, linear_mps: "0.4", kind: "x", target: [1] } }),
    rec(1, { decision: "clamp", reason: "r", applied: { "😀": 1, gripper: 2, angular_radps: null } }),
  ].map((r) => ({ ...r, cmd: r.decision === "allow" ? r.applied : undefined })));
  assert.deepEqual(u.filter((x: any) => x.code === "UNCHECKED_FIELDS").map((x: any) => x.field),
    ["angular_radps", "gripper", "linear_mps", "target", "z_m", "😀", ""]);
  assert.equal(JSON.parse(handle('{"id":"x","op":"replay","input":{"records":[],"envelope":{"a":1e400}}}')).error, "non_finite_number");
});

test("REQ-CL-001..004 command line", () => {
  const d = mkdtempSync(join(tmpdir(), "av-"));
  const env: any = goodEnv();
  const H = envelopeHash(env);
  const chain = mkChain(2, (i) => ({ envelope: H, decision: "allow", cmd: { linear_mps: 0.5 }, applied: { linear_mps: 0.5 }, principal: "p", authority: "a", extra: i }));
  const cf = join(d, "chain.json"), ef = join(d, "env.json"), bad = join(d, "bad.json"), arrf = join(d, "arr.json");
  writeFileSync(cf, JSON.stringify(chain));
  writeFileSync(ef, JSON.stringify(env));
  writeFileSync(bad, "{NaN}");
  writeFileSync(arrf, "[1]");
  const cli = (...a: string[]) => spawnSync("node", ["verify.ts", ...a], { cwd: dir, encoding: "utf8" });

  let r = cli("verify", cf, ef, "--json");
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, records: 2, tail: "unverified", envelope: { valid: true, errors: [] }, findings: [] });
  assert.ok(r.stdout.endsWith("}\n") && r.stdout.split("\n").length === 2);
  r = cli("verify", "--json", cf);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, records: 2, tail: "unverified", envelope: null, findings: [] });
  r = cli("verify", cf, "--head", chain[1].hash, "--json");
  assert.equal(JSON.parse(r.stdout).tail, "anchored");
  assert.equal(r.status, 0);
  r = cli("verify", cf, "--head", "sha256:00", "--json");
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).findings, [{ seq: null, code: "HEAD_MISMATCH" }]);
  assert.equal(JSON.parse(r.stdout).ok, false);
  // unchecked-only is still 0
  const env2 = goodEnv(); const H2 = envelopeHash(env2);
  const c2 = mkChain(1, () => ({ envelope: H2, decision: "stop", reason: "r", applied: { gripper: 1 } }));
  writeFileSync(cf + "2", JSON.stringify(c2));
  r = cli("verify", cf + "2", ef, "--json");
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout).findings, [{ seq: null, code: "UNCHECKED_FIELDS", field: "gripper" }]);
  // invalid envelope -> 1
  const badEnv = goodEnv(); badEnv.level = "L3";
  writeFileSync(join(d, "e3.json"), JSON.stringify(badEnv));
  r = cli("verify", cf, join(d, "e3.json"), "--json");
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).envelope.errors, [{ path: "/level", code: "invalid_value" }]);
  // human output works
  assert.equal(cli("verify", cf, ef).status, 0);
  // usage errors (decided before files are opened)
  for (const a of [[], ["check", cf], ["verify"], ["verify", "--json"], ["verify", cf, "--bogus"], ["verify", cf, "--head"], ["verify", cf, ef, cf], ["verify", "/nonexistent", "--x"]])
    assert.equal(cli(...a).status, 2, a.join(" "));
  // input errors
  for (const a of [["verify", "/nonexistent"], ["verify", bad], ["verify", arrf], ["verify", cf, bad], ["verify", cf, arrf], ["verify", cf, "/nonexistent"], ["verify", d]])
    assert.equal(cli(...a).status, 3, a.join(" "));
  writeFileSync(join(d, "inf.json"), '[{"seq":0,"prev":"p","hash":"h","v":1e400}]');
  assert.equal(cli("verify", join(d, "inf.json")).status, 3);
});

test("canon helper sanity", () => {
  assert.equal(canon({ b: [1, { d: 1, c: 2 }], a: -0 }), '{"a":0,"b":[1,{"c":2,"d":1}]}');
});
