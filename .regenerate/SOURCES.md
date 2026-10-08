# Sources

Where every requirement came from. This file never goes to a builder.

## References (read-only, cloned fresh at pinned commits)

| Name | URL | Commit | Commit date | License |
|---|---|---|---|---|
| rcan-spec (primary) | https://github.com/RobotRegistryFoundation/rcan-spec | `16fc1a4a829426d43b200db4d8e65537810f2e6b` | 2026-10-07 | README § License: "Specification text: CC BY 4.0. Reference implementations: MIT." No LICENSE file at this commit. |
| rcan-ts (secondary) | https://github.com/RobotRegistryFoundation/rcan-ts | `ff8c73dface3814300eeb560ba4a30ac76003165` | 2026-09-29 | MIT (package.json) |
| rcan-py (secondary) | https://github.com/RobotRegistryFoundation/rcan-py | `0184314e8da18ef348d2120e2087ad97d8edcaeb` | 2026-09-29 | MIT (pyproject.toml) |

The brief names one private repository to avoid. It was not used.

Cloned with `git clone -c core.autocrlf=false`; SHAs confirmed with `git rev-parse HEAD`.

## Files read in full

rcan-spec @ `16fc1a4`:
- `spec/appendix-c-physical-assurance.md`: C.1.1 decisions (lines 41–57), C.4 envelope (105–143),
  C.6 `gate_decision` record and stated limit (162–193), C.7 EV-01 to EV-09 (195–215)
- `spec/audit-bundle-v1.md`: "Canonical JSON serialization" (lines 16–29)
- `schemas/envelope.json`, `schemas/gate-decision.json`
- `fixtures/canonical-json-v1.json`, `fixtures/envelope/*` (4 files),
  `fixtures/gate-decision/rover-chain.valid.json`
- `scripts/assurance/evidence-chain.ts` (249 lines; the reference verifier)
- `tests/assurance/envelope-schema.test.ts` (envelope validation: Ajv 2020-12,
  `{ allErrors: true, strict: true }`), `tests/assurance/evidence-chain.test.ts`,
  `tests/assurance/README.md`, `scripts/conformance/rcan-assurance-v0.1.json`
- `README.md` (license), `pnpm-lock.yaml` (ajv 8.20.0)

rcan-ts @ `ff8c73d`: `src/encoding.ts` (canonical JSON writer).

rcan-py @ `0184314`: `rcan/encoding.py` (canonical JSON writer), `rcan/assurance.py`
(a 376-line Python port of the reference verifier, added 2026-09-29 in `ebe1a48`; not listed in
the brief, found while checking the Python SDK's number handling).

## Primary sources

- RFC 8785, JSON Canonicalization Scheme: § 3.1 (input must be I-JSON; no duplicate names),
  § 3.2.2.2 (lone surrogates MUST cause an error), § 3.2.2.3 (NaN and Infinity MUST cause an
  error; ECMAScript number serialization), § 3.2.3 (sort by UTF-16 code units, unsigned,
  locale-independent). Read at https://datatracker.ietf.org/doc/html/rfc8785.
- RFC 8259 (JSON), RFC 6901 (JSON Pointer), RFC 4648 § 4 (base64), FIPS 180-4 (SHA-256),
  JSON Schema 2020-12 (the published envelope schema's dialect).

## Requirement origins

| REQ | Source |
|---|---|
| IF-001…005, IF-007 | Kit interface (REGEN.md § 3); error categories are this spec's own |
| IF-006 | RFC 8259; binary64 reading is what the reference's JSON reader does (`JSON.parse`) |
| CJ-001 | RFC 8785 § 3.2.3; `evidence-chain.ts:49-57` sorts with `.sort()` (UTF-16); contradicts `audit-bundle-v1.md:22` ("code-point order") — D-003 |
| CJ-002 | RFC 8785 § 3.2.2.2; `audit-bundle-v1.md:25,27`; fixture cases |
| CJ-003 | RFC 8785 § 3.2.2.3 (ECMAScript Number::toString); `audit-bundle-v1.md:24` (whole floats as integers) — D-004 |
| CJ-004, CJ-005 | RFC 8785 § 3.2.2.3 and § 3.2.2.2 — D-005, D-006 (the reference writes `null` and `\ud800` instead) |
| CJ-006 | `fixtures/canonical-json-v1.json` (`expected_bytes_base64`) |
| HA-001…003 | `evidence-chain.ts:59-76`; Appendix C C.4 (signature removed) and C.6 (`hash` removed) |
| EV-001…007 | `schemas/envelope.json` restated rule by rule — D-007, D-008, D-020; Appendix C C.4 |
| CH-001 | D-009 (the reference has no precondition) |
| CH-002 | `evidence-chain.ts:100-116`; Appendix C C.6 (`seq` monotonic and contiguous; genesis `prev`) |
| CH-003, CH-004 | `evidence-chain.ts:93-99,117-122`; Appendix C C.6 "Stated limit" — D-010 |
| CH-005 | `evidence-chain.ts:38-42` (Finding shape) — D-016 |
| AA-001, AA-002 | `evidence-chain.ts:126-147` — D-011 |
| RP-001…003 | `evidence-chain.ts:149-223`; Appendix C C.1.1; `schemas/gate-decision.json` (`allOf`: reason required for clamp/reject/stop, `applied` null for reject and object otherwise) — D-012, D-013, D-017 |
| RP-004 | `evidence-chain.ts:171-176,224-226`; Appendix C C.6 ("reports fields it cannot judge rather than passing them silently") — D-014 |
| CL-001…004 | `evidence-chain.ts:230-249` (overlap: exit 0 versus non-zero) — D-015 |
| BU-001, BU-002 | Brief § Budgets |

## Fixtures

Copied byte for byte from rcan-spec @ `16fc1a4` (the repo marks them `-text`):

| Suite path | sha256 |
|---|---|
| `fixtures/canonical-json-v1.json` | `427c0f673cc846525094f02fcf6fadd3b75afbbeca8d8246946e1fe6bdda0ab1` |
| `fixtures/envelope/rover.valid.json` | `855fa35377821502c3db6f204732e4a4b6670dbc362e262635231334d80cff01` |
| `fixtures/envelope/tabletop-arm.valid.json` | `bbf50d54e78ec165f325927c1d62c567c2f3bc3d544d4c27ab93b6b042d2c03e` |
| `fixtures/envelope/fail-open-heartbeat.invalid.json` | `69f5dfde11ed9069e4a704ab1bb3905ade93a72508b0ba9aab28779ae3e52fef` |
| `fixtures/envelope/protocol-level-as-assurance.invalid.json` | `b7abb40fedfd9da0f27caf3c55e5a0f177f29216535147e9ee863186617dee62` |
| `fixtures/gate-decision/rover-chain.valid.json` | `5cb2cfaa66db45d4daa92fa1c98b440173bf3a53f3cd31e3b70daa84223d2f62` |

License: rcan-spec's README puts specification text under CC BY 4.0 and reference
implementations under MIT, and does not say which covers fixtures. This repo treats them as CC BY
4.0 and attributes them in README.md. Craig confirmed that reading before publication
(2026-10-07).

## Extraction evidence (re-checked from the brief's scoping notes)

- All 12 cases of `canonical-json-v1.json` match the oracle byte for byte (`cj-fx-*`).
- `envelopeHash(rover.valid.json)` = `sha256:ef796735bbfa6b725807fe56199b4ed06d90fe16448c06e0777e599362f36731`,
  the `envelope` member of every record in the fixture chain (`ha-rover`). With `signature`
  included it does not match.
- All 6 records in `rover-chain.valid.json` have correct `prev` and `hash` (`ch-valid`); head
  `sha256:ea41b7d8bbaaa247eb65334d9ff566bb8a7ccf1c2afc6347f51505985e378432`. Decisions in order:
  allow, clamp, reject, reject, stop, stop.

## The brief's hypotheses

| # | Hypothesis | Outcome | Entry |
|---|---|---|---|
| 1 | Key-order contradiction in `audit-bundle-v1.md` | Confirmed: line 22 says code-point order, line 29 says it matches RFC 8785 (UTF-16). The reference and rcan-ts sort by UTF-16; rcan-py by code point. Also found: rcan-ts rebuilds an object after sorting, so index-like names (`"9"`, `"10"`) come out first in numeric order. Line 29's "Both SDKs emit byte-identical canonical JSON" holds on the 12 vectors only. | D-003; `cj-utf16-order*`, `cj-sort-digits`; draft note in `kit/posts/rcan-upstream-note.md` |
| 2 | Numbers beyond the 12 cases | Confirmed: rcan-py differs on `1e-7`, `0.000001`, `1e21`, ints above 2^53; NaN/Infinity: reference writes `null`, rcan-py writes `Infinity` | D-004, D-005; `cj-num-*` |
| 3 | String escaping | Confirmed as RFC 8785; lone surrogates: reference writes the `\ud800` escape, rcan-py raises | D-006; `cj-ctl-*`, `cj-lone-*` |
| 4 | Missing versus null | Confirmed as a real divergence: rcan-py's port passes a `reject` with no `applied`, the reference flags it | D-018; `rp-reject-applied-missing` |
| 5 | Which blocks are closed | The schema closes all 12 object types, including proximity rules and `when`; Appendix C C.4's prose says "top-level and limit blocks" | D-007; `ev-unknown-*` |
| 6 | Sequence rules | `seq` starts at 0 and is contiguous (`BAD_GENESIS`, `SEQ_GAP`); `t` is not checked | D-009; `ch-*` |
| 7 | Missing `reason` | Refuted for the reference: it emits nothing. The spec adds `MISSING_REASON` | D-012 |
| 8 | Truncation limit | Pinned as `tail: "unverified"` without an anchor | D-010; `ch-truncated-*`, `cl-truncated-head` |
| 9 | Tamper cases | Generated from the valid chain: mutate, insert, delete, reorder, truncate with and without a head | `ch-*` |

## Reference adapters

- `suite/adapters/reference/`: the reference verifier, loaded by type stripping from the pristine
  clone; envelopes validated with ajv 8.20.0 (scratch install in `_reference/_build/rcan-ajv`).
- `suite/adapters/port-py/`: rcan-py's port (`rcan/assurance.py`), for comparison only.
- `suite/adapters/sdk-ts/`: rcan-ts's canonical JSON writer, canonical cases only.
