# Rebuilding an evidence verifier from its spec

## 1. What this is

This repository holds a specification for a small program, `assurance-verify`, that checks the
evidence a robot's safety gate leaves behind under RCAN's Appendix C: canonical JSON, envelope
validation, a hash-chained log of gate decisions, an authority audit, and a replay of every
applied command against the declared envelope. It also holds a test suite that judges any
implementation from the outside, and two implementations, TypeScript and Python, written by
agents who were shown only the specification. The code under `impl/` is output. The files under
`.regenerate/` are what I maintain.

The layout follows Carson Farmer's `.regenerate/` convention
([iroh-acp-go](https://github.com/carsonfarmer/iroh-acp-go)).
The four things a regenerable system needs (a spec, an evaluation that can judge any version, a
limit on what the builder sees, and a record of how each version was made) come from Chad
Fowler's [writing on regenerative software](https://chadfowler.com/regenerative-software/).

One caveat applies everywhere below. "Blind" means the builder was not shown the earlier
implementation. The model may have seen that public code in training. None of the brief's
eight identifiers and symbols appears anywhere in the four blind transcripts, but the absence of
a signal is not proof.

## 2. Why this program

A third-party verifier is only worth something if a third party can rebuild it and get the same
verdicts. That is regenerability by definition. It is also unforgiving: one byte of difference
in canonical JSON changes every hash downstream. So the spec has to be exact about
serialization and can be quiet about almost everything else.

## 3. What I wrote down

At the released tag, `spec-v1.0.2`:

- **SPEC.md**: 41 pinned requirements and 12 deliberately open items, in 599 lines (4,929 words).
- **DECISIONS.md**: 22 entries (2,807 words), each saying what forced the decision and what else
  was possible.
- **The suite**: 468 cases, each citing at least one requirement. The runner refuses to start if
  a requirement has no case, if a case cites an unknown or open ID, or if SPEC.md's own
  canonical-JSON examples disagree with the suite's model. Its fixtures are the protocol's 12
  canonical vectors, four example envelopes and a six-record chain, copied byte for byte.

The suite computes expected values from an executable model of the spec (294 lines). That is
about the size of the implementations it judges, which says something about where the content
of this program lives.

## 4. Rebuilding it blind

| Run | Spec | Lang | Outcome | Suite | Own tests | Clean | Turns | Time | Cost |
|---|---|---|---|---|---|---|---|---|---|
| r00 | 1.0.0 | earlier TS verifier | finished | 378/422 (n/a 30) | — | — | — | — | — |
| r01 | 1.0.0 | ts | finished | 452/452 | 11/11 | no (3 clarify) | 25 | 4.1 min | $0.80 |
| r02 | 1.0.1 | ts | orphaned | 466/467 | 15/15 | no (1 clarify) | — | ~4.6 min | — |
| r03 | 1.0.2 | ts | finished | 468/468 | 9/9 | **yes** | 25 | 3.1 min | $0.68 |
| r04 | 1.0.2 | py | finished | 468/468 | 28/28 | **yes** | 17 | 3.3 min | $0.63 |

Every builder was `claude-sonnet-5-5`, launched with file tools confined to its folder, no web
or MCP tools, and a shell allowlist, then checked by a transcript audit (zero violations in all
four). r02 was cut off when the container it ran in restarted during its last command; its one
suite failure was a bug in the suite, not in its code. `impl/ts` is r03 (313 lines) and
`impl/py` is r04 (455 lines), both on `spec-v1.0.2`.

## 5. What extraction found

The earlier verifier is 249 lines of TypeScript and its behavior is mostly right. Where it
departs from what the protocol or RFC 8785 says, the cause is the same every time: JavaScript
showing through.

- Infinity is hashed as `null`, because that is what `JSON.stringify` writes. RFC 8785 says it
  must be an error.
- A string with a lone surrogate is written as a `\ud800` escape. RFC 8785 says error.
- `authority: 5` counts as an authority, because 5 is truthy.
- A speed limit written as the string `"0.5"` is enforced anyway, by coercion.

Four checks Appendix C describes are not in it at all: that `allow` applied the command
unchanged, that `clamp`, `reject` and `stop` carry a reason, that `applied` is an object, and
that the decision is one of the four.

The protocol's own text has a contradiction. Its canonical-JSON rules say names sort in
"Unicode code-point order", and in the same section that the scheme "matches RFC 8785", which
sorts by UTF-16 code units. No published test vector tells the two apart. The section also says
both SDKs "emit byte-identical canonical JSON". I ran the suite's canonical cases against both:

- All three earlier implementations (verifier, TypeScript SDK, Python SDK) pass the 12
  published vectors. Past them they diverge.
- The Python SDK writes `1e-7` as `1e-07`, keeps `9007199254740993` exact where the others
  round it, and sorts names by code point.
- The TypeScript SDK sorts names correctly, then rebuilds an object before writing it, and
  JavaScript moves `"9"` ahead of `"10"`.

The Python SDK also contains a hand port of the verifier that says it matches the TypeScript
one "so the two verifiers agree on the same chain". On 265 shared cases their verdicts differ on
25. The note is now filed upstream (section 10).

## 6. What the rebuilds found

- **Unwritten choices.** r01 asked which values each operation turns into canonical bytes,
  since only those can raise a canonical-JSON error. The spec implied it; it now lists them in a
  table (REQ-IF-007).
- **Contradictions.** None inside the spec, from four builds. The one contradiction in this
  project was in the source material (code-point order versus RFC 8785), and extraction caught
  it before any build.
- **Reference quirks.** Every one was settled in DECISIONS.md before the first build (D-005,
  D-006, D-011, D-012, D-017), so the builds never had to choose.
- **Documentation errors.** "Both SDKs emit byte-identical canonical JSON" holds only on the
  published vectors. Appendix C's prose says the envelope schema closes "top-level and limit
  blocks"; the schema closes every object.
- **Silent divergences.** None in any implementation. The one unexplained suite failure (r02,
  `bu-deps`) was the suite's dependency scan reading a regular expression in the builder's own
  test as an import.

Two findings were about the method rather than the program. r01 treated `constructor` and
`__proto__` as ordinary member names. My suite's model used a JavaScript `in` check and called
an envelope with a `constructor` member valid. The builder knew a trap that the suite's author
fell into. And the r02 restart led me to notice that in a cloud container the builder inherited
the orchestrator's whole environment, session tokens included. No builder read it, but an
allowed `node -e` could have. The launcher now starts the builder from an empty environment and
an allow-list, and the isolation test was re-run with it.

## 7. How much to write down

The spec grew by 234 words between 1.0.0 and the released 1.0.2. Most of that came from three
places where a builder had to infer something the text implied. The rest was new open items:
things the builds chose differently that nothing depends on. Two arrived before the release (how
to read non-UTF-8 input, deep nesting) and two after (whether the driver streams, sequence
numbers past 2^53). Every build made 16 to 20 recorded choices. By r03 the spec had already
answered, or deliberately left open, all of them.

What the builds did not need was any help with logic. Chain linkage, the authority audit and
the replay rules came out right the first time in all four builds. What needed words was
serialization and input: number text, key order, which JSON a reader accepts, what counts as a
member. That matches the brief's guess: for a verifier, the remembered knowledge is
serialization. The Python build is the clearest case. Its notes list the three traps the
earlier Python port fell into, and it avoided all three because the spec names them.

## 8. What it cost

Four blind runs out of the six allowed, plus two isolation checks:
- **Logged runs:** $2.12 for the three runs with a result line, plus $0.04 for the isolation
  checks. The orphaned run's cost was not recorded.
- **Builders:** `claude-sonnet-5-5`, 17 to 25 turns, about three to five minutes each.
- **Orchestrating session:** extraction, suite, triage and this writeup took far longer than
  the builds. Their cost is not in the ledger.

## 9. The checklist

| # | Property | Evidence |
|---|---|---|
| P1 | `.regenerate/` is the asset; `impl/` is output | Layout; README |
| P2 | Every file under `impl/` came from a logged blind run | `purity-check.mjs`: both trees equal their promotion entries (r03, r04) |
| P3 | The suite judges from outside, in any language | Driver protocol and CLI only; passes TS and Python builds, the earlier verifier through an adapter |
| P4 | The suite ran against the reference first; every failure explained | r00 to r00.3: 44, 49, 50 and 50 failures, each mapped to a decision |
| P5 | Builders saw only SPEC, DECISIONS and PROMPT; clean audits | Leak check before each launch; audits with 0 violations; isolation test in PREFLIGHT.md. Caveat: before r03 the builder's environment was not cleared (section 6) |
| P6 | Promoted builds come from clean runs on their tag | r03 and r04 at `spec-v1.0.2`, `clean: true` in the ledger |
| P7 | Every run is in the ledger, failures included | r00 to r00.3, r00-port, r00-sdk-ts, r01 to r04 (r02 orphaned), rescores, promotions, and the upstream checks `upstream.1`, `upstream.1-ts`, `upstream.1-port` |
| P8 | Every number here traces to the ledger or a run file | Runs table from `ledger.jsonl`; sizes from the tag; comparisons from PROVENANCE.md |

## 10. What's next

- The canonical-JSON findings in section 5 are filed as
  [RobotRegistryFoundation/rcan-spec#223](https://github.com/RobotRegistryFoundation/rcan-spec/issues/223),
  with pull requests for the spec and reference verifier (#224, a draft until the comment period
  ends, and #225), for rcan-ts (#55, #56) and for rcan-py (#66, a draft, and #67). None is
  merged. With each pair merged locally and an adapter copy that maps their new errors to the
  suite's codes, the suite passes 438/438 against the verifier, 431/431 against rcan-ts and
  277/277 against rcan-py's port (ledger `upstream.1`, `upstream.1-ts`, `upstream.1-port`).
- rcan-spec#224 would take the protocol's canonical test vectors from 12 to 17, plus six inputs
  that must fail. The rest of the suite's canonical cases are not proposed.
- Build a third language, or try a smaller model against the same tag.
