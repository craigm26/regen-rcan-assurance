"""Secondary reference adapter: the earlier Python SDK's port of the earlier verifier.

Speaks the suite's line protocol (SPEC 1.2 and 1.3). Request-level errors (REQ-IF-007 steps
1 to 3, without the 5.1 record-shape check) are answered here, as in the main reference
adapter. Requests are parsed the way the port's own users would parse JSON: json.loads with
its defaults (integers stay exact Python ints), except that NaN and Infinity, which are not
JSON, make the line a bad request. The port has no envelope validator and no command line, so
those cases are n/a for it.

Translations of output format, not behavior: findings become objects; the unchecked field
name the port puts only in its detail text is copied into `field`; a UnicodeEncodeError (the
port refusing a string with no UTF-8 form) becomes the error invalid_string. Any other
exception becomes the non-spec error reference_threw.
"""
import base64
import json
import os
import re
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "local.json"), encoding="utf-8") as f:
    sys.path.insert(0, json.load(f)["sdk"])
from rcan import assurance as A  # noqa: E402
from rcan.encoding import canonical_json  # noqa: E402

UNCHECKED = re.compile(r"^applied\.(.*) is not judged by this reference replay$", re.S)


def is_obj(v):
    return isinstance(v, dict)


def findings(fs):
    out = []
    for f in fs:
        d = {"seq": f.seq, "code": f.code, "detail": f.detail}
        m = UNCHECKED.match(f.detail) if f.code == "UNCHECKED_FIELDS" else None
        if m:
            d["field"] = m.group(1)
        out.append(d)
    return out


NEEDS = {
    "canonical": [("value", lambda v: True, False)],
    "envelopeHash": [("envelope", is_obj, False)],
    "recordHash": [("record", is_obj, False)],
    "verifyChain": [("records", lambda v: isinstance(v, list), False), ("expectedHead", lambda v: isinstance(v, str), True)],
    "auditAuthority": [("records", lambda v: isinstance(v, list), False), ("envelope", is_obj, False)],
    "replay": [("records", lambda v: isinstance(v, list), False), ("envelope", is_obj, False)],
}
RUN = {
    "canonical": lambda i: base64.b64encode(canonical_json(i["value"])).decode("ascii"),
    "envelopeHash": lambda i: A.envelope_hash(i["envelope"]),
    "recordHash": lambda i: A.record_hash(i["record"]),
    "verifyChain": lambda i: {"findings": findings(A.verify_chain(i["records"], i.get("expectedHead")))},
    "auditAuthority": lambda i: {"findings": findings(A.audit_authority(i["records"], i["envelope"]))},
    "replay": lambda i: {"findings": findings(A.replay_against_envelope(i["records"], i["envelope"]))},
}


def reject_constant(name):
    raise ValueError(name)


def answer(line):
    try:
        req = json.loads(line, parse_constant=reject_constant)
    except ValueError:
        return {"id": None, "error": "bad_request"}
    if not is_obj(req) or not isinstance(req.get("id"), str):
        return {"id": None, "error": "bad_request"}
    rid, op, inp = req["id"], req.get("op"), req.get("input")
    if not isinstance(op, str) or op not in NEEDS:
        return {"id": rid, "error": "unknown_op"}
    if not is_obj(inp):
        return {"id": rid, "error": "bad_request"}
    for k, test, optional in NEEDS[op]:
        if k not in inp:
            if optional:
                continue
            return {"id": rid, "error": "bad_request"}
        if not test(inp[k]):
            return {"id": rid, "error": "bad_request"}
    try:
        return {"id": rid, "result": RUN[op](inp)}
    except UnicodeEncodeError:
        return {"id": rid, "error": "invalid_string"}
    except Exception:  # noqa: BLE001
        sys.stderr.write(f"{rid}: {traceback.format_exc()}\n")
        return {"id": rid, "error": "reference_threw"}


for raw in sys.stdin.buffer.read().split(b"\n"):
    line = raw.decode("utf-8")
    if line.strip(" \t\r") == "":
        continue
    sys.stdout.buffer.write((json.dumps(answer(line), allow_nan=True) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()
