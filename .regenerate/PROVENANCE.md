# Provenance

How every version of this program was made. Machine-readable record: `ledger.jsonl`.

## Runs

| Run | Kind | Spec tag | Model | Lang | Outcome | Suite | Own tests | Clean | Notes |
|---|---|---|---|---|---|---|---|---|---|
| r00 | reference | spec-v1.0.0 | — | earlier TS verifier via adapter | finished | 378/422 (n/a 30) | — | — | all 44 failures explained (below) |
| r00-port | reference (comparison) | spec-v1.0.0 | — | Python SDK's port of the verifier | finished | 210/265 (n/a 187) | — | — | not the reference; no validator or CLI |
| r00-sdk-ts | reference (comparison) | spec-v1.0.0 | — | TS SDK's canonical JSON writer | finished | 125/134 (n/a 318) | — | — | canonical cases only |
| r01 | blind | spec-v1.0.0 | claude-sonnet-5-5 | ts | finished | 452/452 | 11/11 | no | 3 clarify (C-2, C-3, C-5); C-10 exposed a suite bug; 25 turns, 4.1 min, $0.80 |
| r00.1 | reference | spec-v1.0.1 | — | earlier TS verifier | finished | 387/436 (n/a 31) | — | — | same explanations; 5 new failures are new cases from r01 |

## r00: the suite against the earlier verifier

Ran 2026-10-07 in a Linux container (Node v22.22.0) against the reference verifier at
`16fc1a4`, loaded unchanged from a pristine clone by type stripping, through
`suite/adapters/reference/`. Envelopes were validated the way the earlier project's own test
does it (ajv 8.20.0, JSON Schema 2020-12, `allErrors` and `strict`), comparing only the
valid/invalid verdict, because the earlier tooling has no error contract. The earlier verifier
has no request protocol, so the adapter answers request-level errors itself; those cases test
the adapter, not the verifier.

452 cases. 30 are n/a for the reference (REGEN class (e)): three folder checks, and 27
command-line cases that need `--json` or exit statuses 2 and 3, which the earlier command line
does not have (D-015). The seven command-line cases it can answer (exit 0 versus non-zero) pass.

All 44 failures are deliberate:

| Class | Decision | Failing cases | What differs |
|---|---|---|---|
| (b) spec choice | D-012 | 11 (`rp-applied-not-object`, `rp-allow-*`, `rp-missing-reason`, `rp-unknown-decision`, `rp-order-*`, `rp-records-many`, `rp-unchecked-not-from-reject-or-nonobject`) | `ALLOW_MODIFIED`, `MISSING_REASON`, `APPLIED_NOT_OBJECT` and `UNKNOWN_DECISION` are new findings |
| (b) spec choice | D-014 | 5 (`rp-unchecked-*`, `rp-speed-string-unchecked-bound`, `rp-stop-ignores-bounds`) | unusable values count as unchecked; names are sorted |
| (c) corrected | D-005 | 6 (`cj-overflow*`, `ha-envelope-overflow`, `ch-record-overflow`, `rp-envelope-overflow`) | infinity is hashed as `null` |
| (c) corrected | D-006 | 6 (`cj-lone-*`, `cj-reversed-pair`, `ha-record-lone`) | a lone surrogate is written as the escape `\ud800` |
| (c) corrected | D-009 | 10 (`shape-*`) | malformed records are judged with missing values |
| (c) corrected | D-011 | 2 (`aa-no-authority-number`, `aa-principal-true`) | authority tested for truthiness |
| (c) corrected | D-017 | 4 (`rp-bound-not-number`, `rp-keep-*-not-polygon`, `rp-keep-out-skips-non-polygon`, `rp-target-not-point`) | type coercion decides bounds, polygons and targets |

Everything else passed: all 12 protocol canonical-JSON vectors, 90 of the other 98 canonical
cases (control characters, number text, UTF-16 order), every hash, all 149 envelope verdicts,
every chain-tampering case, and the authority audit apart from D-011.

Suite bugs found while building r00 (class (a), fixed before the run was recorded):
1. Three case builders passed a request's exact JSON text in the wrong argument position, so
   the cases sent a different request than their names said.
2. A forged-record case hashed an object holding `undefined`, which has no canonical form.
3. Two cases meant to send `-0` sent `0`, because the case builder serialized the value before
   writing it out. They now send the text.

## r00-port and r00-sdk-ts: two earlier implementations that claim to agree

The earlier Python SDK contains a hand port of the verifier, whose docstring says its "finding
codes, hashing and edge-case behaviour match the TypeScript reference so the two verifiers
agree on the same chain". The earlier TypeScript SDK has a canonical JSON writer whose comment
says it matches the Python SDK's. The protocol document says "Both SDKs emit byte-identical
canonical JSON". The suite ran against both as comparison subjects (not as the reference).

- On the 265 cases both the verifier and the port could run, their pass/fail differs on 25.
  The port fails 18 that the verifier passes: key order (2), number text such as `1e-07` and
  `1000000000000000000000` (14), a crash on a non-object `authority` (1), and an absent
  `applied` on a `reject` (1). It passes 7 that the verifier fails, because it raises on lone
  surrogates (6) and checks a bound's type (1).
- The TypeScript SDK's writer fails `cj-sort-digits`: it sorts names, then rebuilds an object,
  and its language puts index-like names (`"9"`, `"10"`) first.
- All three pass the protocol's 12 canonical vectors. Of the suite's 110 canonical cases, the
  verifier passes 102, the TypeScript SDK 101, and the port 91.

## What each run taught

- r00: everything the earlier verifier gets wrong by the specification's standard is either
  JavaScript showing through (truthiness, coercion, `JSON.stringify` writing `null` and escaping
  lone surrogates) or a check Appendix C describes and nobody wrote. The two SDK subjects show
  the same thing from the other side: three implementations that each claim to match the others
  agree on the 12 published vectors and on little past them.
- r01: a clean pass of every case is not a clean run. The build matched the spec everywhere the
  suite looked, and its notes still found three places where a second builder could read the
  spec differently, plus one place where the suite's own model was wrong.
