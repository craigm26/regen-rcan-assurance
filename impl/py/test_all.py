import base64
import json
import os
import subprocess
import sys
import tempfile
import unittest

import lib

def _rt(x):
    return json.loads(json.dumps(x), parse_int=float)


def _wrap(fn):
    return lambda *a: fn(*[_rt(x) for x in a])


# tests build documents with Python ints; the library expects parsed (binary64) numbers
for _n in ("validate_envelope", "verify_chain", "audit_authority", "replay", "hash_of"):
    setattr(lib, _n, _wrap(getattr(lib, _n)))

HERE = os.path.dirname(os.path.abspath(__file__))


def drive(raw):
    p = subprocess.run([sys.executable, os.path.join(HERE, "driver.py")], input=raw,
                       capture_output=True, cwd=HERE)
    assert p.returncode == 0
    return p.stdout


def call(op, inp, rid="x"):
    out = drive((json.dumps({"id": rid, "op": op, "input": inp}) + "\n").encode())
    return json.loads(out)


def canon_text(text):
    r = call_raw('{"id":"c","op":"canonical","input":{"value":%s}}' % text)
    return base64.b64decode(r["result"]).decode("utf-8")


def call_raw(line):
    return json.loads(drive(line.encode() + b"\n"))


def good_env():
    return {
        "envelope_version": "0.1", "machine": {"id": "m", "class": "c"}, "level": "A1",
        "workspace": {"frame": "w", "keep_in": [[0, 0], [10, 0], [10, 10], [0, 10]]},
        "motion": {"max_speed_mps": 1, "max_turn_radps": 2},
        "stop": {"category": 1, "max_time_ms": 100, "max_distance_m": 0},
        "heartbeat": {"model_timeout_ms": 10, "gate_timeout_ms": 10, "on_loss": "stop"},
    }


def codes(env):
    return sorted((e["path"], e["code"]) for e in lib.validate_envelope(env)["errors"])


def chain(n=3):
    recs, prev = [], lib.GENESIS
    for i in range(n):
        r = {"seq": float(i), "prev": prev, "decision": "allow"}
        r["hash"] = lib.hash_of(r, "hash")
        recs.append(r)
        prev = r["hash"]
    return recs


class Protocol(unittest.TestCase):
    def test_blank_crlf_order_and_exit(self):
        out = drive(b'\n  \t\r\n{"id":"a","op":"canonical","input":{"value":1}}\r\n'
                    b'{"id":"b","op":"nope","input":{}}\n')
        lines = out.split(b"\n")
        self.assertEqual(lines[-1], b"")
        self.assertNotIn(b"\r", out)
        self.assertEqual([json.loads(l)["id"] for l in lines[:-1]], ["a", "b"])

    def test_errors(self):
        self.assertEqual(call_raw("[1]"), {"id": None, "error": "bad_request"})
        self.assertEqual(call_raw('{"id":1,"op":"x"}'), {"id": None, "error": "bad_request"})
        self.assertEqual(call_raw('{"id":"i","op":"canonical","input":{"value":NaN}}'),
                         {"id": None, "error": "bad_request"})
        self.assertEqual(call_raw('{"id":"i","op":"zzz"}'), {"id": "i", "error": "unknown_op"})
        self.assertEqual(call_raw('{"id":"i","op":"replay","input":3}'), {"id": "i", "error": "bad_request"})
        self.assertEqual(call("canonical", {}), {"id": "x", "error": "bad_request"})
        self.assertEqual(call_raw('{"id":"i","op":"canonical","input":{"value":[1e400]}}'),
                         {"id": "i", "error": "non_finite_number"})
        self.assertEqual(call_raw('{"id":"i","op":"canonical","input":{"value":"\\ud800"}}'),
                         {"id": "i", "error": "invalid_string"})
        self.assertEqual(call("verifyChain", {"records": [{"seq": 0}]})["error"], "bad_request")
        self.assertEqual(call("verifyChain", {"records": [], "expectedHead": 3})["error"], "bad_request")
        self.assertEqual(call("replay", {"records": [{"seq": -1}], "envelope": {}})["error"], "bad_request")
        self.assertEqual(call("auditAuthority", {"records": [{"seq": 1.5}], "envelope": {}})["error"], "bad_request")

    def test_noncanon_ops_ignore_bad_values(self):
        r = call_raw('{"id":"i","op":"auditAuthority","input":{"records":[{"seq":0,"x":1e400}],"envelope":{"signature":1e400}}}')
        self.assertEqual(r["result"], {"findings": []})


class Canonical(unittest.TestCase):
    def test_examples(self):
        cases = [
            ('{"b":1,"a":2,"c":3}', '{"a":2,"b":1,"c":3}'),
            ('{"x":50.0,"y":-0.0,"z":5e1}', '{"x":50,"y":0,"z":50}'),
            ('[1e21,1e-7,1e16,0.000001,0.1]', '[1e+21,1e-7,10000000000000000,0.000001,0.1]'),
            ('[123456789012345680000,9007199254740993,1.5e-10]', '[123456789012345680000,9007199254740992,1.5e-10]'),
            ('{"name":"Café ☕","path":"a/b"}', '{"name":"Café ☕","path":"a/b"}'),
            ('["\\u001f","\\u0008\\t\\n\\f\\r","\\"\\\\"]', '["\\u001f","\\b\\t\\n\\f\\r","\\"\\\\"]'),
            ('{"\\ue000":1,"\\ud83d\\ude00":2}', '{"😀":2,"":1}'),
            ('{"b":0,"10":1,"9":2,"":3}', '{"":3,"10":1,"9":2,"b":0}'),
            ('{"ok":true,"no":false,"none":null,"list":[],"obj":{}}',
             '{"list":[],"no":false,"none":null,"obj":{},"ok":true}'),
            ('["\\u007f\\u2028/"]', '["\x7f /"]'),
            ('[-1.5,-1e-7,1e300,123e-20]', '[-1.5,-1e-7,1e+300,1.23e-18]'),
        ]
        for i, o in cases:
            self.assertEqual(canon_text(i), o)

    def test_hashes(self):
        h = "sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
        self.assertEqual(call("envelopeHash", {"envelope": {"signature": "x", "a": 1}})["result"], h)
        self.assertEqual(call("recordHash", {"record": {"a": 1, "hash": "y"}})["result"], h)
        self.assertEqual(call("recordHash", {"record": {"hash": "y", "a": {"hash": 1}}})["result"],
                         lib.hash_of({"a": {"hash": 1}}, "x"))
        self.assertEqual(call("envelopeHash", {"envelope": []})["error"], "bad_request")


class Envelope(unittest.TestCase):
    def test_good(self):
        self.assertEqual(lib.validate_envelope(good_env()), {"valid": True, "errors": []})

    def test_examples(self):
        e = good_env(); e["heartbeat"]["on_loss"] = "continue"
        self.assertEqual(codes(e), [("/heartbeat/on_loss", "invalid_value")])
        e = good_env(); e["level"] = "L3"
        self.assertEqual(codes(e), [("/level", "invalid_value")])
        e = good_env(); del e["stop"]
        self.assertEqual(codes(e), [("/stop", "required")])
        e = good_env(); e["motion"]["max_sped_mps"] = 5
        self.assertEqual(codes(e), [("/motion/max_sped_mps", "unknown_member")])
        self.assertEqual(codes([1]), [("", "type")])
        r = call("validateEnvelope", {"envelope": [1]})["result"]
        self.assertEqual(r, {"valid": False, "errors": [{"path": "", "code": "type"}]})

    def test_rules(self):
        e = good_env(); e["envelope_version"] = "0.1\n"
        self.assertEqual(codes(e), [("/envelope_version", "invalid_value")])
        e = good_env(); e["envelope_version"] = "1.0"
        self.assertEqual(codes(e), [("/envelope_version", "invalid_value")])
        e = good_env(); e["machine"]["mass_kg"] = 0; e["machine"]["id"] = ""
        self.assertEqual(codes(e), [("/machine/id", "invalid_value"), ("/machine/mass_kg", "invalid_value")])
        e = good_env(); e["motion"]["max_speed_mps"] = True
        self.assertEqual(codes(e), [("/motion/max_speed_mps", "type")])
        e = good_env(); e["stop"].update(category=3, max_time_ms=300.5)
        self.assertEqual(codes(e), [("/stop/category", "invalid_value"), ("/stop/max_time_ms", "type")])
        e = good_env(); e["stop"]["max_time_ms"] = 300.0; e["force"] = {"max_payload_kg": 0}
        self.assertEqual(codes(e), [])
        e = good_env(); e["motion"]["max_turn_radps"] = float("inf")
        self.assertEqual(codes(e), [("/motion/max_turn_radps", "type")])
        e = good_env(); e["a/b~"] = 1
        self.assertEqual(codes(e), [("/a~1b~0", "unknown_member")])
        e = good_env(); e["signature"] = "ed25519-x:abc"
        self.assertEqual(codes(e), [])
        for bad in ("abc", ":x", "A:x", "a:", "a:x\ny", "a:x "):
            e = good_env(); e["signature"] = bad
            self.assertEqual(codes(e), [("/signature", "invalid_value")], bad)
        e = good_env(); e["signature"] = 3
        self.assertEqual(codes(e), [("/signature", "type")])

    def test_polygons(self):
        e = good_env(); e["workspace"]["keep_in"] = [[0, 0], [1]]
        self.assertEqual(codes(e), [("/workspace/keep_in", "invalid_value"), ("/workspace/keep_in/1", "invalid_value")])
        e = good_env(); e["workspace"]["keep_in"] = [[0, 0], [1, 1], ["a", 1, 2]]
        self.assertEqual(codes(e), [("/workspace/keep_in/2", "invalid_value"), ("/workspace/keep_in/2/0", "type")])
        e = good_env(); e["workspace"]["keep_out"] = [[[0, 0], [1, 1], [0, 1]], 5]
        self.assertEqual(codes(e), [("/workspace/keep_out/1", "type")])
        e = good_env(); e["workspace"]["z_range_m"] = [3, 1]
        self.assertEqual(codes(e), [])
        e["workspace"]["z_range_m"] = [1, 2, 3]
        self.assertEqual(codes(e), [("/workspace/z_range_m", "invalid_value")])

    def test_proximity_and_authority(self):
        e = good_env()
        e["proximity"] = [{"when": {"human_within_m": 1}, "action": 5},
                          {"when": {"human_within_m": 1}},
                          {"when": {"human_within_m": 1}, "action": "stop", "max_speed_mps": 0},
                          {"when": {"human_within_m": 0, "x": 1}, "max_speed_mps": 0}]
        self.assertEqual(codes(e), [("/proximity/0/action", "type"), ("/proximity/1", "invalid_value"),
                                    ("/proximity/2", "invalid_value"), ("/proximity/3/when/human_within_m", "invalid_value"),
                                    ("/proximity/3/when/x", "unknown_member")])
        e = good_env(); e["authority"] = {"required_for": ["a", "a", "a", 1, 1], "resolver": "x"}
        self.assertEqual(codes(e), [("/authority/required_for", "invalid_value"),
                                    ("/authority/required_for/3", "type"),
                                    ("/authority/required_for/4", "type"),
                                    ("/authority/resolver", "invalid_value")])


class Chain(unittest.TestCase):
    def test_clean_and_tail(self):
        c = chain()
        r = lib.verify_chain(c)
        self.assertEqual(r, {"findings": [], "head": c[-1]["hash"], "tail": "unverified"})
        self.assertEqual(lib.verify_chain(c[:2])["findings"], [])
        self.assertEqual(lib.verify_chain(c[:2])["tail"], "unverified")
        self.assertEqual(lib.verify_chain([]), {"findings": [], "head": lib.GENESIS, "tail": "unverified"})
        r = lib.verify_chain(c, c[-1]["hash"])
        self.assertEqual((r["findings"], r["tail"]), ([], "anchored"))
        r = lib.verify_chain(c[:2], c[-1]["hash"])
        self.assertEqual(r["findings"], [{"seq": None, "code": "HEAD_MISMATCH"}])

    def test_findings(self):
        c = chain()
        r = call("verifyChain", {"records": c[1:]})["result"]
        self.assertEqual([(f["seq"], f["code"]) for f in r["findings"]],
                         [(1, "BAD_GENESIS"), (1, "PREV_MISMATCH"), (2, "SEQ_GAP") if False else (2, "PREV_MISMATCH")][:2])
        d = chain()
        d[1]["decision"] = "reject"
        r = lib.verify_chain(d)
        self.assertEqual([(f["seq"], f["code"]) for f in r["findings"]], [(1, "HASH_MISMATCH")])
        d = chain(); d[1]["seq"] = 5.0
        d[1]["hash"] = lib.hash_of(d[1], "hash"); d[2]["prev"] = d[1]["hash"]
        d[2]["hash"] = lib.hash_of(d[2], "hash")
        r = lib.verify_chain(d)
        self.assertEqual([(f["seq"], f["code"]) for f in r["findings"]], [(5, "SEQ_GAP"), (2, "SEQ_GAP")])
        d = chain(2); d[1]["prev"] = "x"; d[1]["hash"] = "y"
        r = lib.verify_chain(d)
        self.assertEqual([f["code"] for f in r["findings"]], ["PREV_MISMATCH", "HASH_MISMATCH"])

    def test_chain_canon_error(self):
        r = call_raw('{"id":"i","op":"verifyChain","input":{"records":[{"seq":0,"prev":"a","hash":"b","v":1e400}]}}')
        self.assertEqual(r["error"], "non_finite_number")


class Authority(unittest.TestCase):
    def test_audit(self):
        env = {"authority": {"required_for": ["motion", "grip", 5]}}
        recs = [
            {"seq": 0, "decision": "allow"},
            {"seq": 1, "decision": "clamp", "cmd": {"kind": "grip"}, "principal": "p", "authority": ""},
            {"seq": 2, "decision": "reject", "cmd": {"kind": "grip"}},
            {"seq": 3, "decision": "allow", "cmd": {"kind": "other"}},
            {"seq": 4, "decision": "allow", "cmd": None, "principal": "p", "authority": "a"},
            {"seq": 5, "decision": "allow", "cmd": {"kind": 3}, "principal": 5, "authority": True},
        ]
        r = lib.audit_authority(recs, env)["findings"]
        self.assertEqual([(f["seq"], f["code"]) for f in r],
                         [(0, "NO_PRINCIPAL"), (0, "NO_AUTHORITY"), (1, "NO_AUTHORITY"),
                          (5, "NO_PRINCIPAL"), (5, "NO_AUTHORITY")])
        self.assertEqual(lib.audit_authority(recs, {"authority": {"required_for": "motion"}})["findings"], [])
        self.assertEqual(lib.audit_authority(recs, {"authority": 3})["findings"], [])


class Replay(unittest.TestCase):
    def setUp(self):
        self.env = good_env()
        self.env["workspace"]["keep_out"] = [[[4, 4], [6, 4], [6, 6], [4, 6]]]
        self.H = lib.hash_of(self.env, "signature")

    def run_one(self, **kw):
        r = {"seq": 0.0, "envelope": self.H}
        r.update(kw)
        return [(f["code"], f.get("field")) for f in lib.replay([r], self.env)["findings"]]

    def test_clean(self):
        cmd = {"kind": "move", "linear_mps": 0.5, "target": [1, 1]}
        self.assertEqual(self.run_one(decision="allow", cmd=cmd, applied=dict(cmd)), [])

    def test_envelope_and_decision(self):
        self.assertEqual(self.run_one(decision="x", envelope="no", applied=3),
                         [("ENVELOPE_MISMATCH", None), ("UNKNOWN_DECISION", None)])
        self.assertEqual(self.run_one(decision=["allow"]), [("UNKNOWN_DECISION", None)])
        r = lib.replay([{"seq": 0, "decision": "reject", "applied": None, "reason": "r"}], self.env)
        self.assertEqual(r["findings"][0]["code"], "ENVELOPE_MISMATCH")

    def test_reject_stop(self):
        self.assertEqual(self.run_one(decision="reject", reason="r", applied=None), [])
        self.assertEqual(self.run_one(decision="reject", reason="r"), [("REJECT_APPLIED", None)])
        self.assertEqual(self.run_one(decision="reject", applied={}), [("REJECT_APPLIED", None), ("MISSING_REASON", None)])
        self.assertEqual(self.run_one(decision="stop", reason="", applied=[]),
                         [("APPLIED_NOT_OBJECT", None), ("MISSING_REASON", None)])
        self.assertEqual(self.run_one(decision="stop", reason="r", applied={"linear_mps": 0.1, "angular_radps": 0.0, "target": [1, 1]}),
                         [("STOP_WITH_MOTION", None), ("UNCHECKED_FIELDS", "target")])
        self.assertEqual(self.run_one(decision="stop", reason="r", applied={"angular_radps": -1}),
                         [("STOP_WITH_MOTION", None)])
        self.assertEqual(self.run_one(decision="allow", cmd={}), [("APPLIED_NOT_OBJECT", None)])

    def test_bounds(self):
        a = {"linear_mps": -1.5, "angular_radps": 3}
        self.assertEqual(self.run_one(decision="allow", cmd=a, applied=a), [("SPEED_EXCEEDED", None), ("TURN_EXCEEDED", None)])
        a = {"linear_mps": 1e400}
        self.assertEqual(self.run_one(decision="clamp", reason="r", applied=a), [("SPEED_EXCEEDED", None)])
        a = {"linear_mps": 1}
        self.assertEqual(self.run_one(decision="allow", cmd=a, applied=a), [])
        a = {"linear_mps": "5", "target": [1]}
        self.assertEqual(self.run_one(decision="clamp", reason="r", applied=a),
                         [("UNCHECKED_FIELDS", "linear_mps"), ("UNCHECKED_FIELDS", "target")])

    def test_geometry(self):
        def t(pt, dec="clamp"):
            return self.run_one(decision=dec, reason="r", applied={"target": pt})
        self.assertEqual(t([0, 0]), [])
        self.assertEqual(t([10, 5]), [])
        self.assertEqual(t([11, 5]), [("OUTSIDE_KEEP_IN", None)])
        self.assertEqual(t([5, 5]), [("INSIDE_KEEP_OUT", None)])
        self.assertEqual(t([4, 5]), [("INSIDE_KEEP_OUT", None)])
        self.assertEqual(t([6, 6]), [("INSIDE_KEEP_OUT", None)])
        self.assertEqual(t([3.9, 5]), [])
        self.assertEqual(t([1e400, 5]), [("UNCHECKED_FIELDS", "target")])

    def test_two_keepouts_and_skips(self):
        sq = [[4, 4], [6, 4], [6, 6], [4, 6]]
        self.env["workspace"]["keep_out"] = [sq, [[0, 0], [1, 1]], sq]
        self.env["workspace"]["keep_in"] = [[0, 0], [1, 1]]
        self.env["motion"] = {"max_speed_mps": "1"}
        self.H = lib.hash_of(self.env, "signature")
        self.assertEqual(self.run_one(decision="clamp", reason="r", applied={"target": [5, 5], "linear_mps": 99}),
                         [("INSIDE_KEEP_OUT", None), ("INSIDE_KEEP_OUT", None)])

    def test_allow_modified(self):
        a = {"linear_mps": 0.5}
        self.assertEqual(self.run_one(decision="allow", cmd={"linear_mps": 0.50}, applied=a), [])
        self.assertEqual(self.run_one(decision="allow", cmd={"linear_mps": 0.4}, applied=a), [("ALLOW_MODIFIED", None)])
        self.assertEqual(self.run_one(decision="allow", applied=a), [("ALLOW_MODIFIED", None)])
        self.assertEqual(self.run_one(decision="clamp", reason="r", cmd={}, applied=a), [])

    def test_unchecked_sorted_distinct(self):
        recs = [{"seq": 0, "envelope": self.H, "decision": "allow", "cmd": {"": 1, "b": 1, "kind": "k"},
                 "applied": {"": 1, "b": 1, "kind": "k"}},
                {"seq": 1, "envelope": self.H, "decision": "allow", "cmd": {"\U0001F600": 1, "b": 1},
                 "applied": {"\U0001F600": 1, "b": 1}}]
        f = lib.replay(recs, self.env)["findings"]
        self.assertEqual([x["field"] for x in f], ["b", "\U0001F600", ""])
        self.assertTrue(all(x["seq"] is None and x["code"] == "UNCHECKED_FIELDS" for x in f))

    def test_replay_canon_errors(self):
        r = call_raw('{"id":"i","op":"replay","input":{"records":[],"envelope":{"a":1e400}}}')
        self.assertEqual(r["error"], "non_finite_number")
        r = call_raw('{"id":"i","op":"replay","input":{"records":[{"seq":0,"decision":"allow","applied":{"x":1e400},"cmd":{}}],"envelope":{}}}')
        self.assertEqual(r["error"], "non_finite_number")
        r = call_raw('{"id":"i","op":"replay","input":{"records":[{"seq":0,"decision":"clamp","reason":"r","applied":{"x":1e400}}],"envelope":{}}}')
        self.assertIn("result", r)


class Cli(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def path(self, name, content):
        p = os.path.join(self.d, name)
        with open(p, "wb") as fh:
            fh.write(content if isinstance(content, bytes) else json.dumps(content).encode())
        return p

    def cli(self, *args):
        p = subprocess.run([sys.executable, os.path.join(HERE, "cli.py"), *args],
                           capture_output=True, cwd=HERE)
        return p.returncode, p.stdout

    def test_usage(self):
        missing = os.path.join(self.d, "none.json")
        for args in ([], ["check", missing], ["verify"], ["verify", missing, "--bogus"],
                     ["verify", missing, "--head"], ["verify", "a", "b", "c"], ["verify", "--json"]):
            self.assertEqual(self.cli(*args)[0], 2, args)

    def test_bad_input(self):
        self.assertEqual(self.cli("verify", os.path.join(self.d, "none.json"))[0], 3)
        self.assertEqual(self.cli("verify", self.path("a.json", b"[NaN]"))[0], 3)
        self.assertEqual(self.cli("verify", self.path("b.json", {"a": 1}))[0], 3)
        self.assertEqual(self.cli("verify", self.path("c.json", [{"seq": 0}]))[0], 3)
        self.assertEqual(self.cli("verify", self.path("d.json", b"[]"), self.path("e.json", []))[0], 3)
        self.assertEqual(self.cli("verify", self.path("f.json", b"\xff[]"))[0], 3)
        self.assertEqual(self.cli("verify", self.path("g.json", [{"seq": 0, "prev": "a", "hash": "b", "x": 1}]),
                                  self.path("h.json", b'{"a":1e400}'))[0], 3)

    def test_json_output(self):
        c = chain()
        cp = self.path("c.json", [{**r, "seq": int(r["seq"])} for r in c])
        code, out = self.cli("verify", cp, "--json")
        self.assertEqual(code, 0)
        self.assertEqual(out[-1:], b"\n")
        self.assertEqual(json.loads(out), {"ok": True, "records": 3, "tail": "unverified",
                                           "envelope": None, "findings": []})
        code, out = self.cli("verify", cp, "--json", "--head", "sha256:00")
        self.assertEqual(code, 1)
        doc = json.loads(out)
        self.assertEqual((doc["ok"], doc["tail"], doc["findings"]),
                         (False, "anchored", [{"seq": None, "code": "HEAD_MISMATCH"}]))
        code, out = self.cli("verify", "--head", c[-1]["hash"], cp)
        self.assertEqual(code, 0)

    def test_envelope_run(self):
        env = good_env()
        H = lib.hash_of(env, "signature")
        r = {"seq": 0, "prev": lib.GENESIS, "decision": "allow", "envelope": H,
             "cmd": {"gripper": 1}, "applied": {"gripper": 1}}
        r["hash"] = lib.hash_of(r, "hash")
        cp, ep = self.path("c.json", [r]), self.path("e.json", env)
        code, out = self.cli("verify", cp, ep, "--json")
        doc = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(doc["envelope"], {"valid": True, "errors": []})
        self.assertEqual(doc["findings"], [{"seq": None, "code": "UNCHECKED_FIELDS", "field": "gripper"}])
        env["level"] = "Z"
        code, out = self.cli("verify", cp, self.path("e2.json", env), "--json")
        doc = json.loads(out)
        self.assertEqual(code, 1)
        self.assertFalse(doc["envelope"]["valid"])
        self.assertEqual(doc["findings"][0]["code"], "ENVELOPE_MISMATCH")
        code, out = self.cli("verify", cp, ep)
        self.assertEqual(code, 0)


class Budget(unittest.TestCase):
    def test_lines(self):
        n = 0
        for f in os.listdir(HERE):
            if f.endswith(".py") and not f.startswith("test_"):
                with open(os.path.join(HERE, f), encoding="utf-8") as fh:
                    n += sum(1 for l in fh if l.strip())
        self.assertLessEqual(n, 500)


if __name__ == "__main__":
    unittest.main()
