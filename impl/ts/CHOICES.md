# Choices

## C-1: Hashing a value whose removed member is non-finite
- Spec reference: REQ-HA-002, REQ-HA-003, REQ-CJ-004
- Situation: ambiguous
- What I chose: the member (`signature`, `hash`) is dropped before canonicalization, so only the remaining value is checked for non-finite numbers and bad strings.
- Alternatives: check the whole value first.
- Should the spec pin this? no, nothing realistic depends on it.

## C-2: Canonical errors are lazy
- Spec reference: REQ-IF-007 step 4
- Situation: ambiguous
- What I chose: an operation fails with `non_finite_number` or `invalid_string` only if it actually canonicalizes the bad value. `replay` always hashes the envelope. It canonicalizes `applied`/`cmd` only for `allow` records that reach step 6.4. `auditAuthority` never canonicalizes. `verifyChain` hashes every record.
- Alternatives: scan all inputs eagerly for bad numbers and strings.
- Should the spec pin this? yes. A suite could send a `clamp` record with an infinite number in an unused member and expect either answer.

## C-3: Both `max_speed_mps` and `action` check counts presence, not validity
- Spec reference: REQ-EV-006
- Situation: ambiguous
- What I chose: "exactly one of" counts members that are present, whatever their type. A rule with `action: 5` and no `max_speed_mps` gets only `type` at `/…/action`.
- Alternatives: count only well-typed members.
- Should the spec pin this? unsure.

## C-4: Rule checks continue after unknown or missing members; all rules run
- Spec reference: REQ-EV-002
- Situation: ambiguous
- What I chose: `unknown_member` and `required` are reported alongside errors in other members. Per-value `type` suppresses only checks inside that value. Error order is by member in input order, then missing required members in rule order (open per OPEN-EV-001).
- Alternatives: stop at the first error.
- Should the spec pin this? no.

## C-5: Polygon points in replay must be fully valid
- Spec reference: REQ-RP-002
- Situation: ambiguous
- What I chose: a keep-in or keep-out candidate is a polygon only if it has at least 3 elements and every element is an array of exactly two finite numbers. Otherwise it is skipped.
- Alternatives: keep valid points only and drop bad ones.
- Should the spec pin this? yes. "an array of at least three points" does not say whether a bad element disqualifies the polygon.

## C-6: Point-in-polygon uses exact arithmetic
- Spec reference: REQ-RP-003, OPEN-RP-001
- Situation: missing
- What I chose: "on an edge" means the cross product is exactly 0 and the point is inside the edge's bounding box. Strictly-inside uses the even-odd ray rule. No tolerance.
- Alternatives: a 1e-9 tolerance.
- Should the spec pin this? no, it is already open.

## C-7: `STOP_WITH_MOTION` is one finding
- Spec reference: REQ-RP-001 step 5
- Situation: ambiguous
- What I chose: one finding per record, even if both linear and angular speed are non-zero.
- Alternatives: one finding per field.
- Should the spec pin this? no. The wording "if … or …" implies a single finding.

## C-8: Non-finite numbers as `applied` speeds
- Spec reference: REQ-RP-001 step 6, REQ-RP-004
- Situation: ambiguous
- What I chose: a speed of infinity (from `1e400`) counts as "a number" for the bound checks and for "judged". This differs from REQ-EV-003, where numbers are finite. A `target` still needs finite coordinates.
- Alternatives: treat infinity as not a number.
- Should the spec pin this? unsure.

## C-9: Unchecked-field scan covers every `allow`/`clamp`/`stop` record with an object `applied`
- Spec reference: REQ-RP-004
- Situation: ambiguous
- What I chose: records with an unknown decision or a `reject` decision are not scanned. Records with `ENVELOPE_MISMATCH` are scanned.
- Alternatives: scan only records with no other findings.
- Should the spec pin this? no.

## C-10: Own-property lookups only
- Spec reference: REQ-IF-006, REQ-RP-001
- Situation: missing
- What I chose: every member lookup uses own properties, so inherited names such as `constructor` or `toString` never count as members. A `__proto__` member in the JSON text is an ordinary member.
- Alternatives: plain property access.
- Should the spec pin this? no.

## C-11: Invalid UTF-8 and a byte order mark
- Spec reference: REQ-IF-002, OPEN-CL-002
- Situation: missing / open
- What I chose: command-line files are decoded as strict UTF-8, so invalid bytes give exit 3, and a leading BOM is stripped and accepted. The driver decodes stdin leniently (invalid bytes become U+FFFD) and keeps a BOM, so a BOM on the first line makes it `bad_request`.
- Alternatives: reject a BOM in files, or strictly validate stdin.
- Should the spec pin this? yes for stdin. Invalid UTF-8 on stdin is unspecified.

## C-12: Command-line argument edge cases
- Spec reference: REQ-CL-001, OPEN-CL-003
- Situation: ambiguous
- What I chose: the value after `--head` is taken whatever it looks like, including `--json`. A repeated option is allowed and the last `--head` wins. A single-dash argument is treated as a file path. A third file argument is a usage error.
- Alternatives: reject these as usage errors.
- Should the spec pin this? no, it is already open.

## C-13: Human-readable output
- Spec reference: OPEN-CL-001
- Situation: missing
- What I chose: without `--json`, one line per finding (`<seq|-> <CODE> [field]`), one line per envelope error, and a final `OK`/`FAIL` summary. Nothing is written on exit 2 or 3.
- Alternatives: a usage message on stderr.
- Should the spec pin this? no.

## C-14: Order of CLI shape checks
- Spec reference: REQ-CL-002, REQ-CL-003
- Situation: ambiguous
- What I chose: the chain file is read and checked, then the envelope file. Any failure is exit 3. All of this happens before any check runs, so no partial output is written.
- Alternatives: none that change the exit status.
- Should the spec pin this? no.

## C-15: `package.json` is not used; tests run with `node --test`
- Spec reference: REQ-IF-001
- Situation: missing
- What I chose: no `package.json`. `REGEN.json` `test` is `node --test`, which finds `*.test.ts` by default. `npm test` therefore does not work.
- Alternatives: add a `package.json` with a `test` script and no dependencies.
- Should the spec pin this? no.

## C-16: `seq` accepts large and negative-zero integers
- Spec reference: REQ-CH-001
- Situation: ambiguous
- What I chose: any finite integer-valued number that is `>= 0` is a valid `seq`, including `-0` and values above 2^53. `-0` is printed as `0`.
- Alternatives: restrict `seq` to safe integers.
- Should the spec pin this? no.

## C-17: Driver request and `input` shape
- Spec reference: REQ-IF-007
- Situation: ambiguous
- What I chose: a missing `op` or a non-string `op` gives `unknown_op` even if `input` is also bad. A request with `id` present but not a string gives `bad_request` with a null `id`.
- Alternatives: none; this follows the stated order.
- Should the spec pin this? no.
