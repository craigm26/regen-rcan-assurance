import json
import sys

import lib


def usage():
    sys.stderr.write("usage: verify <chain-file> [<envelope-file>] [--json] [--head <hash>]\n")
    return 2


def parse_args(argv):
    if not argv or argv[0] != "verify":
        return None
    files, as_json, head, i = [], False, None, 1
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            as_json = True
        elif a == "--head":
            if i + 1 >= len(argv):
                return None
            i += 1
            head = argv[i]
        elif a.startswith("--"):
            return None
        else:
            files.append(a)
        i += 1
    if not 1 <= len(files) <= 2:
        return None
    return files, as_json, head


def load(path):
    with open(path, "rb") as fh:
        return lib.loads(fh.read().decode("utf-8"))


def run(files, head):
    chain = load(files[0])
    if not lib.records_ok(chain, True):
        raise ValueError("chain shape")
    env = None
    if len(files) == 2:
        env = load(files[1])
        if type(env) is not dict:
            raise ValueError("envelope shape")
    chain_res = lib.verify_chain(chain, head)
    findings = list(chain_res["findings"])
    env_res = None
    if env is not None:
        env_res = lib.validate_envelope(env)
        findings += lib.audit_authority(chain, env)["findings"]
        findings += lib.replay(chain, env)["findings"]
    return len(chain), chain_res["tail"], env_res, findings


def main(argv):
    parsed = parse_args(argv)
    if parsed is None:
        return usage()
    files, as_json, head = parsed
    try:
        n, tail, env_res, findings = run(files, head)
    except (OSError, ValueError, RecursionError, lib.CanonError) as e:
        sys.stderr.write("error: %s\n" % (e,))
        return 3
    bad = any(f["code"] != "UNCHECKED_FIELDS" for f in findings) or (env_res is not None and not env_res["valid"])
    status = 1 if bad else 0
    if as_json:
        doc = {"ok": not bad, "records": n, "tail": tail, "envelope": env_res, "findings": findings}
        line = json.dumps(doc, ensure_ascii=True, separators=(",", ":"))
    else:
        lines = ["records: %d, tail: %s" % (n, tail)]
        if env_res is not None:
            lines.append("envelope: %s" % ("valid" if env_res["valid"] else "invalid"))
            lines += ["  %s %s" % (e["path"], e["code"]) for e in env_res["errors"]]
        lines += ["finding: seq=%s %s%s" % (f["seq"], f["code"], " " + f["field"] if "field" in f else "")
                  for f in findings]
        lines.append("OK" if not bad else "FAILED")
        line = "\n".join(lines)
    sys.stdout.buffer.write(line.encode("utf-8", "backslashreplace") + b"\n")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
