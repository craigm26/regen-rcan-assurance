# assurance-verify: specification

- Program: `assurance-verify`
- Document version: 1.0.1
- Date: 2026-10-07

`assurance-verify` checks the evidence a robot's safety gate leaves behind, as defined by the
RCAN specification's Appendix C (Physical Assurance Profile). Two kinds of document are
involved. An **envelope** declares a machine's physical limits: its workspace polygon, speed
limits, stop behavior and so on. A **chain** is an append-only log of `gate_decision` records,
one per decision the gate made (`allow`, `clamp`, `reject` or `stop`), each record carrying the
SHA-256 hash of the previous one. The program computes the canonical bytes and hashes these
documents are signed and chained over, validates envelopes, verifies chain linkage, audits
that executed commands carry an authority, and replays every applied command against the
envelope. It checks evidence. It does not check a robot, and a clean result says nothing about
whether a machine behaved as its log claims.

Implementations are judged only from outside: through a line-oriented driver program (§ 1)
and a command-line program (§ 8). Everything not stated here is open.

Conventions: MUST / MUST NOT are requirements; SHOULD marks an advisory requirement whose test
never fails a run. Requirements have IDs `REQ-<AREA>-<NNN>`. Deliberately unpinned behavior has
IDs `OPEN-<AREA>-<NNN>` (§ 10) and is never tested. "Number" means an IEEE 754 binary64 value.
Examples use `⟶` to separate input from output.

---

## 1. Interface

### 1.1 REGEN.json

**REQ-IF-001.** The implementation folder MUST contain `REGEN.json`, a JSON object with keys
`lang`, `build`, `test`, `driver` and `cli`. `lang` is `"ts"` or `"py"`. Each of the other four
is either a command string or an object whose keys are Node.js `process.platform` values (for
example `"win32"`) plus a required `"default"` key, each mapping to a command string. The suite
picks the entry for its own platform, else `default`. Example:

```json
{"lang":"py",
 "build":"",
 "test":   {"win32":"py -3 -m unittest -q", "default":"python3 -m unittest -q"},
 "driver": {"win32":"py -3 driver.py",      "default":"python3 driver.py"},
 "cli":    {"win32":"py -3 cli.py",         "default":"python3 cli.py"}}
```

- Commands run with the implementation folder as the working directory.
- `build` and `test` run through the platform shell (cmd.exe on Windows, `/bin/sh` elsewhere).
  An empty `build` string means there is nothing to build.
- `driver` and `cli` never go through a shell. The suite splits each on single spaces and starts
  the first word as a program with the remaining words as arguments; for `cli` it then appends
  the arguments of the invocation under test (§ 8), each as its own argument. They MUST
  therefore be plain space-separated words: no quotes, pipes, redirects, `&&`, or `.cmd` shims
  such as `npx`.
- Build output, if any, goes in `bin/`.
- The same REGEN.json MUST work on Windows and on Linux; the suite runs on both.

### 1.2 Driver protocol

**REQ-IF-002.** The driver reads requests from standard input and writes responses to standard
output. Standard input is UTF-8 text (OPEN-IF-003), split into lines at LF (`0x0A`) only:
every other character, CR (`0x0D`) included, belongs to the line it is in, and CR is JSON
whitespace, so a line that ends in CR LF is still one JSON object. Each request is one line holding one JSON
object. For each non-blank request line the driver MUST write exactly one response line holding
one JSON object, in the same order as the requests. Blank lines (empty, or only spaces, tabs and
CRs) produce no response. The driver MUST exit with status 0 after standard input reaches end of
file and every response has been written.

**REQ-IF-003.** Standard output MUST be UTF-8. Every response line MUST end with a single LF
(`0x0A`) and MUST NOT contain CR (`0x0D`) anywhere. Nothing other than response lines may be
written to standard output. (Standard error is free; see OPEN-IF-001.)

**REQ-IF-004.** A request has the shape `{"id": <string>, "op": <string>, "input": <object>}`.
`id` is echoed unchanged in the response. `op` names the operation (§ 1.3). `input` holds the
operation's members. Unknown extra members in a request or in `input` are ignored.

Example:

```
{"id":"c-1","op":"canonical","input":{"value":{"b":1,"a":2}}}
```

**REQ-IF-005.** A successful response MUST be exactly `{"id": <id>, "result": <result>}`. The
suite compares `result` as a parsed JSON value: object member order does not matter, array order
does, and numbers compare exactly.

**REQ-IF-006.** Requests and the command line's input files (§ 8) are JSON text as RFC 8259
defines it. `NaN`, `Infinity` and anything else outside that grammar make a line or a file "not
JSON". Every JSON number in them MUST be taken as the binary64 value nearest to its decimal text,
whatever the text looks like: `50`, `50.0` and `5e1` are the same value, and `9007199254740993`
is the value 9007199254740992. A number whose text is too large for binary64 (for example
`1e400`) becomes infinity, which § 2 then rejects. Strings may contain any escape JSON allows,
including `\ud800`-style escapes that produce unpaired surrogates (§ 2.4). An object that repeats
a member name is out of scope (OPEN-IF-002).

**REQ-IF-007.** Errors. If a request cannot be answered with a result, the response MUST be
exactly `{"id": <id>, "error": <category>}` with no other members, and the driver MUST continue
with the next line. Checks happen in this order; the first that applies decides the response:

1. The line is not a JSON object, or `id` is missing or not a string ⟶ `bad_request` with
   `"id": null`.
2. `op` is missing, not a string, or not one of the operations in § 1.3 ⟶ `unknown_op`.
3. `input` is missing or not an object, or a member the operation requires is missing or has the
   wrong JSON type (see the table in § 1.3), or a records array fails § 5.1 ⟶ `bad_request`.
4. The operation needs canonical bytes (§ 2) of a value that contains a non-finite number ⟶
   `non_finite_number`; or an unpaired surrogate ⟶ `invalid_string`. When a value contains
   both, either category is acceptable (OPEN-CJ-001).

Only these values are ever canonicalized, so only they can cause step 4:

| op | values canonicalized |
|---|---|
| `canonical` | `value` |
| `envelopeHash`, `recordHash` | the input object without its removed top-level member |
| `verifyChain` | each record without its top-level `hash` |
| `replay` | the envelope without its top-level `signature`; and `applied` and `cmd` of each `allow` record that reaches REQ-RP-001 step 6.4 |
| `validateEnvelope`, `auditAuthority` | nothing |

A non-finite number or unpaired surrogate anywhere else (in a `clamp` record given to `replay`,
in a removed `signature`, anywhere in an `auditAuthority` request) is just a value.

Error message text is not part of the contract; only these two members appear.

### 1.3 Operations

| op | input members | result |
|---|---|---|
| `canonical` | `value` (any JSON value) | base64 string, § 2.5 |
| `envelopeHash` | `envelope` (object) | hash string, § 3 |
| `recordHash` | `record` (object) | hash string, § 3 |
| `validateEnvelope` | `envelope` (any JSON value) | `{valid, errors}`, § 4 |
| `verifyChain` | `records` (array), `expectedHead` (string, optional) | `{findings, head, tail}`, § 5 |
| `auditAuthority` | `records` (array), `envelope` (object) | `{findings}`, § 6 |
| `replay` | `records` (array), `envelope` (object) | `{findings}`, § 7 |

"Object" means a JSON object (not an array, not `null`). For `verifyChain`, an `expectedHead`
that is present but not a string is a `bad_request`.

---

## 2. Canonical JSON

Canonical JSON is the byte form that envelopes are hashed and signed over and that chain
records are hashed over. It follows RFC 8785 (JSON Canonicalization Scheme). Two independent
implementations MUST produce the same bytes for the same value, because one differing byte
changes every hash.

### 2.1 Structure

**REQ-CJ-001.** The canonical form of a value is UTF-8 text with no whitespace outside strings.
`null`, `true` and `false` are written as those literals. An array is `[`, its elements'
canonical forms in their original order separated by `,`, then `]`. An object is `{`, its members
as `"name":value` separated by `,`, then `}`, with the members **sorted by name, comparing names
as sequences of UTF-16 code units** (RFC 8785 § 3.2.3). This is not the same as code-point
order: a name starting with a character outside the Basic Multilingual Plane (encoded as a
surrogate pair, `0xD800`–`0xDBFF` first) sorts before a name starting with a character in
`U+E000`–`U+FFFF`. Names are compared as strings even when they look like numbers: `"10"`
sorts before `"9"`.

### 2.2 Strings

**REQ-CJ-002.** A string (a value or a member name) is written as `"`, its characters, `"`,
where:

- `"` is written `\"` and `\` is written `\\`;
- U+0008, U+0009, U+000A, U+000C and U+000D are written `\b`, `\t`, `\n`, `\f` and `\r`;
- every other character from U+0000 to U+001F is written `\u00` followed by two **lowercase**
  hexadecimal digits (U+001F is `\u001f`);
- every other character, including `/`, U+007F and U+2028, is written as itself in UTF-8.

### 2.3 Numbers

**REQ-CJ-003.** A number is written the way ECMAScript's `Number::toString` writes it (RFC 8785
§ 3.2.2.3). Negative zero is written `0`. For any other finite number x, write `-` first if x is
negative and continue with its magnitude. Let k, n and s be integers such that k ≥ 1,
10^(k−1) ≤ s < 10^k, s × 10^(n−k) equals the magnitude, and k is as small as possible (s holds
the shortest digits that round-trip). Then:

1. If k ≤ n ≤ 21: the k digits of s followed by n − k zeros.
2. If 0 < n ≤ 21: the first n digits of s, `.`, then the remaining k − n digits.
3. If −6 < n ≤ 0: `0.`, then −n zeros, then the k digits of s.
4. Otherwise: if k = 1, the single digit of s; else the first digit of s, `.`, and the remaining
   k − 1 digits. Then `e`, then `+` if n − 1 ≥ 0 else `-`, then the decimal value of |n − 1|.

A number with no fractional part is therefore written without one (`50.0` ⟶ `50`), because it
is the same binary64 value (REQ-IF-006).

**REQ-CJ-004.** Infinity, negative infinity and NaN have no canonical form. An operation that
needs the canonical form of a value containing one MUST respond with error `non_finite_number`.

### 2.4 Unpaired surrogates

**REQ-CJ-005.** A string or member name that contains an unpaired surrogate (a code unit in
`0xD800`–`0xDFFF` that is not part of a valid high-low pair) has no UTF-8 form. An operation that
needs the canonical form of a value containing one MUST respond with error `invalid_string`.

### 2.5 The `canonical` operation

**REQ-CJ-006.** `canonical` returns the canonical form of `input.value` as a base64 string
(RFC 4648 § 4: standard alphabet, with `=` padding, no line breaks).

### 2.6 Examples

Each line shows a JSON input value and its canonical text. In the right-hand column, a
`\uXXXX` sequence for a character at or above U+007F stands for that character written raw
(canonical text never escapes it); the suite checks these examples against its own model at
load.

| Input | Canonical text |
|---|---|
| `{"b":1,"a":2,"c":3}` | `{"a":2,"b":1,"c":3}` |
| `{"x":50.0,"y":-0.0,"z":5e1}` | `{"x":50,"y":0,"z":50}` |
| `[1e21,1e-7,1e16,0.000001,0.1]` | `[1e+21,1e-7,10000000000000000,0.000001,0.1]` |
| `[123456789012345680000,9007199254740993,1.5e-10]` | `[123456789012345680000,9007199254740992,1.5e-10]` |
| `{"name":"Café ☕","path":"a/b"}` | `{"name":"Café ☕","path":"a/b"}` |
| `["\u001f","\u0008\t\n\f\r","\"\\"]` | `["\u001f","\b\t\n\f\r","\"\\"]` |
| `{"\ue000":1,"\ud83d\ude00":2}` | `{"😀":2,"\ue000":1}` |
| `{"b":0,"10":1,"9":2,"":3}` | `{"":3,"10":1,"9":2,"b":0}` |
| `{"ok":true,"no":false,"none":null,"list":[],"obj":{}}` | `{"list":[],"no":false,"none":null,"obj":{},"ok":true}` |

---

## 3. Hashes

**REQ-HA-001.** A hash string is `sha256:` followed by the 64 lowercase hexadecimal digits of the
SHA-256 digest (FIPS 180-4) of a value's canonical UTF-8 bytes.

**REQ-HA-002.** `envelopeHash` returns the hash of `input.envelope` with its top-level member
`signature` removed, if present. A `signature` member nested deeper is kept.

**REQ-HA-003.** `recordHash` returns the hash of `input.record` with its top-level member `hash`
removed, if present.

Example: the hash of `{"a":1}` is
`sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862`, so `envelopeHash` of
`{"signature":"x","a":1}` and `recordHash` of `{"a":1,"hash":"y"}` both return it.

---

## 4. Envelope validation

`validateEnvelope` checks that `input.envelope` is a well-formed Appendix C envelope. It checks
form only. A valid envelope says nothing about whether the declared limits are adequate.

**REQ-EV-001.** The result is `{"valid": <boolean>, "errors": [<error>, ...]}`. Each error is
`{"path": <string>, "code": <string>}`, with no other members. `valid` is `true` exactly when
`errors` is empty. The order of errors is open (OPEN-EV-001). `path` is a JSON Pointer
(RFC 6901) into the envelope: `""` for the envelope itself, `/motion/max_speed_mps` for that
member, `/workspace/keep_in/2/0` for an array element. Inside a member name, `~` is written `~0`
and `/` is written `~1`.

**REQ-EV-002.** Error codes:

- `type`: the value at `path` has the wrong JSON type. Nothing further is checked inside that
  value.
- `required`: a required member is missing. `path` points at the missing member (for example
  `/heartbeat/on_loss`).
- `unknown_member`: an object has a member its rules do not list. `path` points at that member.
  **Every object in an envelope is closed**: the envelope itself and every object inside it.
- `invalid_value`: the value has the right type but breaks another rule in § 4.1.

All errors are reported, not just the first.

**REQ-EV-003.** Types. "Object" is a JSON object; "array" is a JSON array; "string" is a JSON
string; "number" is a finite number (a boolean is never a number); "integer" is a number with no
fractional part (`300` and `300.0` are both integers; `300.5` is a `type` error).

### 4.1 Rules

**REQ-EV-004.** The envelope is an object with these members. "Required" members must be present.
"> 0" means strictly greater than zero; "≥ 0" means zero or greater.

| Member | Type | Required | Rule |
|---|---|---|---|
| `envelope_version` | string | yes | `0`, `.`, then one or more ASCII digits `0`–`9`, and nothing else (no trailing newline) |
| `machine` | object | yes | members below |
| `machine.id` | string | yes | at least one character |
| `machine.class` | string | yes | at least one character |
| `machine.mass_kg` | number | no | > 0 |
| `level` | string | yes | one of `A1`, `A2`, `A3` |
| `workspace` | object | yes | members below |
| `workspace.frame` | string | yes | at least one character |
| `workspace.keep_in` | polygon | yes | § 4.2 |
| `workspace.keep_out` | array of polygons | no | each element a polygon |
| `workspace.z_range_m` | pair | no | § 4.2 |
| `motion` | object | yes | members below |
| `motion.max_speed_mps` | number | yes | > 0 |
| `motion.max_turn_radps` | number | no | > 0 |
| `motion.max_accel_mps2` | number | no | > 0 |
| `motion.max_joint_speed_radps` | number | no | > 0 |
| `force` | object | no | members below |
| `force.max_contact_force_n` | number | no | > 0 |
| `force.max_payload_kg` | number | no | ≥ 0 |
| `proximity` | array | no | each element a proximity rule, § 4.3 |
| `sensing` | object | no | members below |
| `sensing.max_state_age_ms` | integer | no | > 0 |
| `stop` | object | yes | members below |
| `stop.category` | integer | yes | one of 0, 1, 2 |
| `stop.max_time_ms` | integer | yes | > 0 |
| `stop.max_distance_m` | number | yes | ≥ 0 |
| `heartbeat` | object | yes | members below |
| `heartbeat.model_timeout_ms` | integer | yes | > 0 |
| `heartbeat.gate_timeout_ms` | integer | yes | > 0 |
| `heartbeat.on_loss` | string | yes | exactly `stop` |
| `authority` | object | no | members below |
| `authority.required_for` | array of strings | no | no two elements equal (§ 4.4) |
| `authority.resolver` | string | no | one of `external`, `local` |
| `signature` | string | no | one or more characters from `a`–`z`, `0`–`9` and `-`; then `:`; then one or more characters, none of which is LF, CR, U+2028 or U+2029 |

Errors are reported in this order of precedence for a single value: a `type` error replaces
every other check of that value. Otherwise each applicable rule is checked.

### 4.2 Points, pairs and polygons

**REQ-EV-005.** A **point** and a **pair** are each an array that MUST have exactly two
elements (otherwise `invalid_value` at the array's path), and each of its first two elements
MUST be a number (otherwise `type` at that element's path). Both checks are made: `[1]` gives
`invalid_value` at the array, and `["a",1,2]` gives `invalid_value` at the array and `type` at
element `0`. A **polygon** is an array that MUST have at least three elements (otherwise
`invalid_value` at the polygon's path), and every element MUST be a point (checked as above at
the element's path). Polygons are not otherwise checked: their winding, closure and
self-intersection are open. A pair's two numbers may be in any order.

### 4.3 Proximity rules

**REQ-EV-006.** A proximity rule is an object with these members, and no others:

| Member | Type | Required | Rule |
|---|---|---|---|
| `when` | object | yes | exactly one member, `human_within_m`, a number > 0, required |
| `max_speed_mps` | number | no | ≥ 0 |
| `action` | string | no | exactly `stop` |

In addition, a rule MUST have exactly one of `max_speed_mps` and `action` present, whatever
their values. A rule with both present or with neither gets `invalid_value` at the rule's own
path, in addition to any other errors (so `{"when": {"human_within_m": 1}, "action": 5}` gets
only `type` at `.../action`).

### 4.4 Uniqueness

**REQ-EV-007.** If two string elements of `authority.required_for` are the same string, report
one `invalid_value` at `/authority/required_for`, however many duplicates there are. Elements
that are not strings get `type` at their own paths and take no part in this comparison.

### 4.5 Examples

```
envelope whose heartbeat.on_loss is "continue"  ⟶ {"valid":false,"errors":[{"path":"/heartbeat/on_loss","code":"invalid_value"}]}
envelope whose level is "L3"                    ⟶ {"valid":false,"errors":[{"path":"/level","code":"invalid_value"}]}
envelope without stop                            ⟶ {"valid":false,"errors":[{"path":"/stop","code":"required"}]}
envelope whose motion has "max_sped_mps": 5      ⟶ {"valid":false,"errors":[{"path":"/motion/max_sped_mps","code":"unknown_member"}]}
validateEnvelope of the value [1]                ⟶ {"valid":false,"errors":[{"path":"","code":"type"}]}
```

---

## 5. Chain verification

A chain is an array of `gate_decision` records in log order. Every record has at least `seq`
(its position number), `prev` (the hash of the previous record) and `hash` (its own hash, per
REQ-HA-003). The first record's `prev` is the **genesis value**: `sha256:` followed by 64 zeros.

### 5.1 Record shape

**REQ-CH-001.** For `verifyChain`, `auditAuthority` and `replay`, `input.records` MUST be an
array whose every element is an object whose `seq` is a non-negative integer. For
`verifyChain`, every element's `prev` and `hash` MUST also be strings. Otherwise the response is
error `bad_request` (REQ-IF-007 step 3). Records may have any other members.

### 5.2 Checks

**REQ-CH-002.** `verifyChain` checks each record in array order and reports, in this order for
each record:

1. `BAD_GENESIS` if it is the first record and its `seq` is not 0.
2. `SEQ_GAP` if it is not the first record and its `seq` is not the previous record's `seq` + 1.
3. `PREV_MISMATCH` if its `prev` is not the genesis value (first record) or the previous record's
   `hash` (any other record). The previous record's `hash` member is used as written, not
   recomputed.
4. `HASH_MISMATCH` if its `hash` is not its record hash (REQ-HA-003).

Each finding is `{"seq": <the record's seq>, "code": <code>}`.

### 5.3 Head and tail

**REQ-CH-003.** The chain's **head** is the last record's `hash` member as written, or the
genesis value for an empty array. The result is `{"findings": [...], "head": <head>, "tail":
<tail>}`. If `input.expectedHead` is given, `tail` is `"anchored"`, and if the head differs
from it, a final finding `{"seq": null, "code": "HEAD_MISMATCH"}` is appended. If
`expectedHead` is not given, `tail` is `"unverified"`.

**REQ-CH-004.** A hash chain cannot show that records were removed from its end. That needs
the last hash anchored somewhere the writer cannot rewrite. An unanchored chain with records
cut from the end therefore verifies without findings, and `tail` MUST be `"unverified"`. The
program MUST never report an unanchored chain as complete.

### 5.4 Findings

**REQ-CH-005.** In every operation, a finding is an object with members `seq` (an integer, or
`null` for a finding about the chain or envelope as a whole) and `code` (a string), plus `field`
where § 7 says so. A finding MAY also have a `detail` member holding a string; its text is open
(OPEN-CH-001). The suite compares findings as an ordered list of `seq`, `code` and `field`.

---

## 6. Authority audit

**REQ-AA-001.** `auditAuthority` looks only at records whose `decision` is `"allow"` or
`"clamp"` (commands that executed). For each, the command's **kind** is `cmd.kind` if `cmd` is
an object whose `kind` is a string, and `"motion"` otherwise (including when `cmd` is `null` or
missing). The kind is **gated** if it equals a string element of `envelope.authority.required_for`.
If `authority` is not an object or `required_for` is not an array, no kind is gated. Non-string
elements of `required_for` are ignored.

**REQ-AA-002.** For each executed record whose kind is gated, in record order: report
`NO_PRINCIPAL` if its `principal` is not a non-empty string, then `NO_AUTHORITY` if its
`authority` is not a non-empty string (missing, `null`, `""`, a number, `true` and so on all
count as "not a non-empty string"). The result is `{"findings": [...]}`.

---

## 7. Replay

`replay` checks every record against the envelope it claims to have been decided under, and
checks what each decision applied to the actuators. Appendix C defines the four decisions:

| decision | meaning | `applied` |
|---|---|---|
| `allow` | the command executes unchanged | the command |
| `clamp` | the command executes after being brought inside the envelope | the modified command |
| `reject` | the command does not execute | `null` |
| `stop` | the machine is brought to a stop | the stop action |

**REQ-RP-001.** Let H be the envelope hash of `input.envelope` (REQ-HA-002). For each record,
in record order, report the following findings, in this order, each as
`{"seq": <the record's seq>, "code": <code>}`:

1. `ENVELOPE_MISMATCH` if the record's `envelope` member is not H.
2. `UNKNOWN_DECISION` if `decision` is not one of the four strings above. The remaining checks
   are skipped for this record.
3. For `reject`: `REJECT_APPLIED` unless the record has an `applied` member whose value is
   `null`.
4. For `allow`, `clamp` and `stop`: `APPLIED_NOT_OBJECT` if `applied` is missing or is not an
   object. Steps 5 and 6 are skipped for this record.
5. For `stop`: `STOP_WITH_MOTION` if `applied.linear_mps` is a number other than 0, or
   `applied.angular_radps` is a number other than 0.
6. For `allow` and `clamp`, using the bounds in REQ-RP-002:
   1. `SPEED_EXCEEDED` if `applied.linear_mps` is a number whose absolute value exceeds
      `max_speed_mps`.
   2. `TURN_EXCEEDED` if `applied.angular_radps` is a number whose absolute value exceeds
      `max_turn_radps`.
   3. If `applied.target` is a point (an array of exactly two finite numbers):
      `OUTSIDE_KEEP_IN` if there is a keep-in polygon and the target is not inside or on it;
      then `INSIDE_KEEP_OUT` once for each keep-out polygon, in envelope order, that the target
      is inside or on.
   4. For `allow` only: `ALLOW_MODIFIED` if the canonical form (§ 2) of `applied` differs from
      that of `cmd` (a missing `cmd` counts as `null`).
7. For `clamp`, `reject` and `stop`: `MISSING_REASON` if the record's `reason` is not a
   non-empty string.

**REQ-RP-002.** Bounds come from the envelope as given; `replay` does not validate it (§ 4 does).

- `max_speed_mps` is `envelope.motion.max_speed_mps` and `max_turn_radps` is
  `envelope.motion.max_turn_radps`, each only if it is a number. A bound that is absent is not
  checked.
- Here a **polygon** is an array of three or more elements, every one of which is a point (an
  array of exactly two finite numbers). An array with even one other element is not a polygon.
- The keep-in polygon is `envelope.workspace.keep_in` if it is a polygon. Otherwise there is no
  keep-in polygon.
- The keep-out polygons are the elements of `envelope.workspace.keep_out` (if it is an array)
  that are polygons. Other elements are skipped.

**REQ-RP-003.** A point is **inside or on** a polygon if it lies on any edge, vertices
included, or strictly inside it. The polygon's edges join consecutive points and the last
point back to the first. A point on the boundary of a keep-in polygon is therefore allowed, and
a point on the boundary of a keep-out polygon is not. For polygons whose edges cross each other,
the result is open (OPEN-RP-001).

**REQ-RP-004.** Fields the replay cannot judge are reported, never passed silently. For each
`allow`, `clamp` and `stop` record whose `applied` is an object, a member of `applied` is
**judged** if it is one of these, and **unchecked** otherwise:

- `kind`, with any value;
- `linear_mps` or `angular_radps` whose value is a number;
- for `allow` and `clamp` only, `target` whose value is a point.

So `"linear_mps": "0.4"`, `"target": [1]`, a `target` on a `stop` record, and any other member
name (`"gripper"`, `"z_m"`) are unchecked. After all per-record findings, append one finding
`{"seq": null, "code": "UNCHECKED_FIELDS", "field": <name>}` for each distinct unchecked member
name, sorted by name as in REQ-CJ-001 (UTF-16 code units). `UNCHECKED_FIELDS` is the only code
with a `field` member.

**REQ-RP-005.** The result is `{"findings": [...]}`.

---

## 8. Command line

**REQ-CL-001.** The program started by REGEN.json `cli` accepts:

```
verify <chain-file> [<envelope-file>] [--json] [--head <hash>]
```

- The first argument MUST be `verify`.
- `<chain-file>` is required. `<envelope-file>` is optional.
- `--json` and `--head <hash>` may appear anywhere after `verify`. The argument after `--head`
  is its value.
- Every other argument is a file path, opened as given (a relative path is relative to the
  working directory; the suite passes absolute paths), except that an argument starting with
  `--` is an option.
- A first argument other than `verify` (or no arguments), a missing `<chain-file>`, an option
  other than `--json` and `--head`, `--head` without a value, or more than two file arguments
  is a usage error. Usage errors are decided before any file is opened.

**REQ-CL-002.** What it checks:

1. Input files are UTF-8 JSON text (REQ-IF-006). The chain file must hold a JSON array of
   records meeting § 5.1, including `prev` and `hash` as strings.
2. The envelope file, if given, must hold a JSON object.
3. It runs `verifyChain` on the chain, with `expectedHead` set to the `--head` value if given.
4. If an envelope is given, it also runs `validateEnvelope` on it, then `auditAuthority` and
   `replay` on the chain against it.
5. Any value that needs canonical bytes and has none (§ 2) makes the input unusable.

**REQ-CL-003.** Exit status:

| status | when |
|---|---|
| 0 | the checks ran, no finding other than `UNCHECKED_FIELDS` was reported, and the envelope (if given) is valid |
| 1 | the checks ran, and some other finding was reported or the envelope is invalid |
| 2 | usage error |
| 3 | a file cannot be read, is not JSON, does not have the required shape, or has no canonical form |

**REQ-CL-004.** With `--json` and exit status 0 or 1, standard output MUST be exactly one line
holding one JSON object with exactly these five members, followed by LF:

```
{"ok": <bool>, "records": <int>, "tail": "anchored"|"unverified",
 "envelope": null | {"valid": <bool>, "errors": [...]},
 "findings": [...]}
```

- `ok` is `true` exactly when the exit status is 0.
- `records` is the number of records in the chain.
- `tail` is as in REQ-CH-003.
- `envelope` is `null` without an envelope file, otherwise the `validateEnvelope` result.
- `findings` is the `verifyChain` findings, then, if an envelope was given, the
  `auditAuthority` findings, then the `replay` findings.

The suite compares the members as in REQ-CH-005 and REQ-EV-001. Without `--json`, and on exit
status 2 or 3, the content of standard output and standard error is open (OPEN-CL-001).

---

## 9. Budgets

**REQ-BU-001.** At most 500 non-blank lines of implementation source per language.

- Count every non-blank line, comments included, in files ending `.ts`, `.mts`, `.mjs` or `.js`
  (TypeScript) or `.py` (Python) under the implementation folder.
- Leave out test files: names matching `*.test.*`, `*_test.*` or `test_*.py`, and anything under
  a folder named `test` or `tests`.
- `REGEN.json` and Markdown files are not counted.

**REQ-BU-002.** No dependencies outside the language's standard library.

- TypeScript: Node.js 22.18 or later, with modules imported only by relative path or the
  `node:` prefix, and no `node_modules`.
- Python: 3.11 or later, importing only standard-library modules and modules in the
  implementation folder.

---

## 10. Open

These are deliberately unpinned. Any reasonable choice is fine, and nothing should depend on
them.

- **OPEN-IF-001.** What the driver and the command line write to standard error.
- **OPEN-IF-002.** Requests or input files whose JSON objects repeat a member name.
- **OPEN-IF-003.** Standard input that is not valid UTF-8, or that starts with a byte order
  mark.
- **OPEN-CJ-001.** Which error category a value gets when it contains both a non-finite number
  and an unpaired surrogate.
- **OPEN-EV-001.** The order of errors in a `validateEnvelope` result.
- **OPEN-CH-001.** The presence and text of a finding's `detail` member.
- **OPEN-RP-001.** Whether a point is inside a polygon whose edges cross each other, and how
  points closer than 10^-9 to an edge but not exactly on it are classified.
- **OPEN-CL-001.** Command-line output without `--json`, and all output on exit status 2 or 3.
- **OPEN-CL-002.** Whether an input file that starts with a UTF-8 byte order mark is accepted.
- **OPEN-CL-003.** Arguments that start with a single `-`, options given more than once, and a
  `--head` value that starts with `--`.
- **OPEN-LIB-001.** The names and shapes of any library functions behind the driver and the
  command line.
