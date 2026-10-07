import json
import sys

import lib


def _shape(inp, name, kind):
    return name in inp and type(inp[name]) is kind


def _records(inp, chain=False):
    return _shape(inp, "records", list) and lib.records_ok(inp["records"], chain)


def handle(op, inp):
    """Return a result, or raise CanonError / ValueError('bad')."""
    if op == "canonical":
        if "value" not in inp:
            raise ValueError("bad")
        return lib.canonical_b64(inp["value"])
    if op in ("envelopeHash", "recordHash"):
        name, drop = ("envelope", "signature") if op == "envelopeHash" else ("record", "hash")
        if not _shape(inp, name, dict):
            raise ValueError("bad")
        return lib.hash_of(inp[name], drop)
    if op == "validateEnvelope":
        if "envelope" not in inp:
            raise ValueError("bad")
        return lib.validate_envelope(inp["envelope"])
    if op == "verifyChain":
        if not _records(inp, True) or ("expectedHead" in inp and type(inp["expectedHead"]) is not str):
            raise ValueError("bad")
        return lib.verify_chain(inp["records"], inp.get("expectedHead"))
    if op in ("auditAuthority", "replay"):
        if not _records(inp) or not _shape(inp, "envelope", dict):
            raise ValueError("bad")
        fn = lib.audit_authority if op == "auditAuthority" else lib.replay
        return fn(inp["records"], inp["envelope"])


OPS = ("canonical", "envelopeHash", "recordHash", "validateEnvelope", "verifyChain",
       "auditAuthority", "replay")


def respond(line):
    try:
        req = lib.loads(line)
    except (ValueError, RecursionError):
        return {"id": None, "error": "bad_request"}
    if type(req) is not dict or type(req.get("id")) is not str:
        return {"id": None, "error": "bad_request"}
    rid = req["id"]
    op = req.get("op")
    if type(op) is not str or op not in OPS:
        return {"id": rid, "error": "unknown_op"}
    inp = req.get("input")
    if type(inp) is not dict:
        return {"id": rid, "error": "bad_request"}
    try:
        return {"id": rid, "result": handle(op, inp)}
    except lib.CanonError as e:
        return {"id": rid, "error": e.code}
    except (ValueError, RecursionError):
        return {"id": rid, "error": "bad_request"}


def main():
    data = sys.stdin.buffer.read().decode("utf-8", "replace")
    out = sys.stdout.buffer
    for line in data.split("\n"):
        if line.strip(" \t\r") == "":
            continue
        text = json.dumps(respond(line), ensure_ascii=True, separators=(",", ":"))
        out.write(text.encode("ascii") + b"\n")
    out.flush()


if __name__ == "__main__":
    main()
