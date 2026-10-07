import base64
import hashlib
import json
import math
from fractions import Fraction

GENESIS = "sha256:" + "0" * 64


class CanonError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _const(name):
    raise ValueError(name)


def loads(text):
    return json.loads(text, parse_int=float, parse_constant=_const)


def u16(s):
    return s.encode("utf-16-be", "surrogatepass")


# ---------- canonical JSON ----------
_ESC = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}


def _str(s):
    out = []
    for c in s:
        o = ord(c)
        if 0xD800 <= o <= 0xDFFF:
            raise CanonError("invalid_string")
        if c in _ESC:
            out.append(_ESC[c])
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(c)
    return '"' + "".join(out) + '"'


def _num(x):
    if not math.isfinite(x):
        raise CanonError("non_finite_number")
    if x == 0:
        return "0"
    mant, _, exp = repr(abs(x)).partition("e")
    ip, _, fp = mant.partition(".")
    digits = ip + fp
    n = len(ip) + int(exp or 0)
    lead = digits.lstrip("0")
    n -= len(digits) - len(lead)
    s = lead.rstrip("0")
    k = len(s)
    if k <= n <= 21:
        r = s + "0" * (n - k)
    elif 0 < n <= 21:
        r = s[:n] + "." + s[n:]
    elif -6 < n <= 0:
        r = "0." + "0" * (-n) + s
    else:
        e = n - 1
        r = s[0] + ("." + s[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return ("-" if x < 0 else "") + r


def canon(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    t = type(v)
    if t is float:
        return _num(v)
    if t is str:
        return _str(v)
    if t is list:
        return "[" + ",".join(canon(x) for x in v) + "]"
    return "{" + ",".join(_str(k) + ":" + canon(v[k]) for k in sorted(v, key=u16)) + "}"


def canonical_b64(v):
    return base64.b64encode(canon(v).encode("utf-8")).decode("ascii")


def hash_of(obj, drop):
    body = {k: v for k, v in obj.items() if k != drop}
    return "sha256:" + hashlib.sha256(canon(body).encode("utf-8")).hexdigest()


# ---------- type helpers ----------
def isnum(v):
    return type(v) is float and math.isfinite(v)


def isint(v):
    return isnum(v) and v.is_integer()


def isstr(v):
    return type(v) is str


def nonempty(v):
    return type(v) is str and v != ""


# ---------- envelope validation ----------
def _ptr(p, k):
    return p + "/" + str(k).replace("~", "~0").replace("/", "~1")


def _s(ok=lambda v: True):
    def f(v, p, E):
        if type(v) is not str:
            E.append((p, "type"))
        elif not ok(v):
            E.append((p, "invalid_value"))
    return f


def _n(ok=lambda v: True, integer=False):
    def f(v, p, E):
        if not (isint(v) if integer else isnum(v)):
            E.append((p, "type"))
        elif not ok(v):
            E.append((p, "invalid_value"))
    return f


def _o(members, extra=None):
    def f(v, p, E):
        if type(v) is not dict:
            E.append((p, "type"))
            return
        for k in v:
            if k not in members:
                E.append((_ptr(p, k), "unknown_member"))
        for k, (g, req) in members.items():
            if k in v:
                g(v[k], _ptr(p, k), E)
            elif req:
                E.append((_ptr(p, k), "required"))
        if extra:
            extra(v, p, E)
    return f


def _a(item, extra=None, minlen=0):
    def f(v, p, E):
        if type(v) is not list:
            E.append((p, "type"))
            return
        if len(v) < minlen:
            E.append((p, "invalid_value"))
        if extra:
            extra(v, p, E)
        for i, x in enumerate(v):
            item(x, _ptr(p, i), E)
    return f


def _point(v, p, E):
    if type(v) is not list:
        E.append((p, "type"))
        return
    if len(v) != 2:
        E.append((p, "invalid_value"))
    for i in range(min(2, len(v))):
        if not isnum(v[i]):
            E.append((_ptr(p, i), "type"))


_poly_v = _a(_point, minlen=3)
_pos = lambda x: x > 0
_nonneg = lambda x: x >= 0


def _version_ok(v):
    return v.startswith("0.") and len(v) > 2 and all(c in "0123456789" for c in v[2:])


def _sig_ok(v):
    i = v.find(":")
    if i < 1 or not all(c in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in v[:i]):
        return False
    rest = v[i + 1:]
    return rest != "" and not any(c in "\n\r  " for c in rest)


def _one_of_rule(v, p, E):
    if ("max_speed_mps" in v) == ("action" in v):
        E.append((p, "invalid_value"))


def _dups(v, p, E):
    strs = [x for x in v if type(x) is str]
    if len(set(strs)) != len(strs):
        E.append((p, "invalid_value"))


_rule = _o({
    "when": (_o({"human_within_m": (_n(_pos), True)}), True),
    "max_speed_mps": (_n(_nonneg), False),
    "action": (_s(lambda x: x == "stop"), False),
}, _one_of_rule)

_ENVELOPE = _o({
    "envelope_version": (_s(_version_ok), True),
    "machine": (_o({
        "id": (_s(lambda x: x != ""), True),
        "class": (_s(lambda x: x != ""), True),
        "mass_kg": (_n(_pos), False)}), True),
    "level": (_s(lambda x: x in ("A1", "A2", "A3")), True),
    "workspace": (_o({
        "frame": (_s(lambda x: x != ""), True),
        "keep_in": (_poly_v, True),
        "keep_out": (_a(_poly_v), False),
        "z_range_m": (_point, False)}), True),
    "motion": (_o({
        "max_speed_mps": (_n(_pos), True),
        "max_turn_radps": (_n(_pos), False),
        "max_accel_mps2": (_n(_pos), False),
        "max_joint_speed_radps": (_n(_pos), False)}), True),
    "force": (_o({
        "max_contact_force_n": (_n(_pos), False),
        "max_payload_kg": (_n(_nonneg), False)}), False),
    "proximity": (_a(_rule), False),
    "sensing": (_o({"max_state_age_ms": (_n(_pos, True), False)}), False),
    "stop": (_o({
        "category": (_n(lambda x: x in (0, 1, 2), True), True),
        "max_time_ms": (_n(_pos, True), True),
        "max_distance_m": (_n(_nonneg), True)}), True),
    "heartbeat": (_o({
        "model_timeout_ms": (_n(_pos, True), True),
        "gate_timeout_ms": (_n(_pos, True), True),
        "on_loss": (_s(lambda x: x == "stop"), True)}), True),
    "authority": (_o({
        "required_for": (_a(_s(), _dups), False),
        "resolver": (_s(lambda x: x in ("external", "local")), False)}), False),
    "signature": (_s(_sig_ok), False),
})


def validate_envelope(env):
    E = []
    _ENVELOPE(env, "", E)
    return {"valid": not E, "errors": [{"path": p, "code": c} for p, c in E]}


# ---------- chain ----------
def records_ok(recs, chain=False):
    if type(recs) is not list:
        return False
    for r in recs:
        if type(r) is not dict or not isint(r.get("seq")) or r["seq"] < 0:
            return False
        if chain and not (isstr(r.get("prev")) and isstr(r.get("hash"))):
            return False
    return True


def _f(r, code):
    return {"seq": int(r["seq"]), "code": code}


def verify_chain(recs, expected=None):
    out = []
    prev_hash, prev_seq = GENESIS, None
    for i, r in enumerate(recs):
        if i == 0:
            if r["seq"] != 0:
                out.append(_f(r, "BAD_GENESIS"))
        elif r["seq"] != prev_seq + 1:
            out.append(_f(r, "SEQ_GAP"))
        if r["prev"] != prev_hash:
            out.append(_f(r, "PREV_MISMATCH"))
        if r["hash"] != hash_of(r, "hash"):
            out.append(_f(r, "HASH_MISMATCH"))
        prev_hash, prev_seq = r["hash"], r["seq"]
    if expected is None:
        return {"findings": out, "head": prev_hash, "tail": "unverified"}
    if prev_hash != expected:
        out.append({"seq": None, "code": "HEAD_MISMATCH"})
    return {"findings": out, "head": prev_hash, "tail": "anchored"}


# ---------- authority ----------
def audit_authority(recs, env):
    auth = env.get("authority")
    req = auth.get("required_for") if type(auth) is dict else None
    gated = {x for x in req if type(x) is str} if type(req) is list else set()
    out = []
    for r in recs:
        if r.get("decision") not in ("allow", "clamp") or not isstr(r.get("decision")):
            continue
        cmd = r.get("cmd")
        kind = cmd["kind"] if type(cmd) is dict and isstr(cmd.get("kind")) else "motion"
        if kind in gated:
            if not nonempty(r.get("principal")):
                out.append(_f(r, "NO_PRINCIPAL"))
            if not nonempty(r.get("authority")):
                out.append(_f(r, "NO_AUTHORITY"))
    return {"findings": out}


# ---------- replay ----------
def _pt(v):
    return type(v) is list and len(v) == 2 and all(isnum(c) for c in v)


def _poly(v):
    return type(v) is list and len(v) >= 3 and all(_pt(q) for q in v)


def inside(pt, poly):
    px, py = Fraction(pt[0]), Fraction(pt[1])
    P = [(Fraction(a), Fraction(b)) for a, b in poly]
    res = False
    for i in range(len(P)):
        (ax, ay), (bx, by) = P[i], P[i - 1]
        if ((bx - ax) * (py - ay) == (by - ay) * (px - ax)
                and min(ax, bx) <= px <= max(ax, bx) and min(ay, by) <= py <= max(ay, by)):
            return True
        if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
            res = not res
    return res


def replay(recs, env):
    H = hash_of(env, "signature")
    m, w = env.get("motion"), env.get("workspace")
    m = m if type(m) is dict else {}
    w = w if type(w) is dict else {}
    max_speed, max_turn = m.get("max_speed_mps"), m.get("max_turn_radps")
    keep_in = w.get("keep_in") if _poly(w.get("keep_in")) else None
    ko = w.get("keep_out")
    keep_out = [q for q in ko if _poly(q)] if type(ko) is list else []
    out, unchecked = [], set()
    for r in recs:
        add = lambda c: out.append(_f(r, c))
        if r.get("envelope") != H:
            add("ENVELOPE_MISMATCH")
        d = r.get("decision")
        if d not in ("allow", "clamp", "reject", "stop") or not isstr(d):
            add("UNKNOWN_DECISION")
            continue
        a = r.get("applied")
        if d == "reject":
            if "applied" not in r or a is not None:
                add("REJECT_APPLIED")
        elif type(a) is not dict:
            add("APPLIED_NOT_OBJECT")
        else:
            lin, ang, tgt = a.get("linear_mps"), a.get("angular_radps"), a.get("target")
            if d == "stop":
                if (type(lin) is float and lin != 0) or (type(ang) is float and ang != 0):
                    add("STOP_WITH_MOTION")
            else:
                if type(lin) is float and type(max_speed) is float and abs(lin) > max_speed:
                    add("SPEED_EXCEEDED")
                if type(ang) is float and type(max_turn) is float and abs(ang) > max_turn:
                    add("TURN_EXCEEDED")
                if _pt(tgt):
                    if keep_in is not None and not inside(tgt, keep_in):
                        add("OUTSIDE_KEEP_IN")
                    for q in keep_out:
                        if inside(tgt, q):
                            add("INSIDE_KEEP_OUT")
                if d == "allow" and canon(a) != canon(r.get("cmd")):
                    add("ALLOW_MODIFIED")
            for k, v in a.items():
                judged = (k == "kind" or (k in ("linear_mps", "angular_radps") and type(v) is float)
                          or (k == "target" and d != "stop" and _pt(v)))
                if not judged:
                    unchecked.add(k)
        if d != "allow" and not nonempty(r.get("reason")):
            add("MISSING_REASON")
    for k in sorted(unchecked, key=u16):
        out.append({"seq": None, "code": "UNCHECKED_FIELDS", "field": k})
    return {"findings": out}
