## C-1: Driver test command and Node's test runner
- Spec reference: REQ-IF-001
- Situation: missing
- What I chose: `test` is `node --test`, which finds `*.test.ts` by itself on Node 22.18+.
- Alternatives: `npm test` (needs a package.json, which the build rules forbid dependencies in); listing the test file by name.
- Should the spec pin this? no, REGEN.json is the implementation's own.

## C-2: JSON parsing uses the platform's JSON.parse
- Spec reference: REQ-IF-006
- Situation: missing (spec states the grammar but not how to parse it)
- What I chose: `JSON.parse`. It is strict RFC 8259, takes numbers as the nearest binary64 (`1e400` gives Infinity) and accepts `\ud800` escapes. Whitespace is exactly space, tab, LF and CR.
- Alternatives: a hand-written parser (costs the line budget, no behavior gain).
- Should the spec pin this? no.

## C-3: Explicit `expectedHead: null` and other non-string values
- Spec reference: REQ-IF-007 step 3, § 1.3
- Situation: ambiguous
- What I chose: any present `expectedHead` that is not a string, `null` included, is `bad_request`.
- Alternatives: treat `null` as absent.
- Should the spec pin this? no, it already says "present but not a string".

## C-4: Checks run in a fixed order inside `run`
- Spec reference: REQ-IF-007
- Situation: ambiguous
- What I chose: for `verifyChain` the type of `records` and `expectedHead` is checked before the per-record shape. For `replay` and `auditAuthority`, `records` is checked, then `envelope`, then the record shape. All of these are `bad_request`, so the order is invisible.
- Alternatives: none that differ.
- Should the spec pin this? no.

## C-5: Canonical errors in `replay` come from the envelope first
- Spec reference: REQ-IF-007 step 4, table
- Situation: ambiguous
- What I chose: the envelope's canonical form is computed up front, even with an empty chain. `applied` and `cmd` are canonicalized lazily, only for an `allow` record that reaches step 6.4. If any of these fails, the whole response is the error.
- Alternatives: turn the failure into a finding (the spec says it is an error).
- Should the spec pin this? no.

## C-6: A `signature` member of a non-string kind
- Spec reference: REQ-EV-004
- Situation: ambiguous
- What I chose: the envelope is `type` at `/signature` when it is not a string. A string that fails the pattern is `invalid_value`. "One or more characters after the colon" is measured in UTF-16 units, which only matters for lone surrogates; those count as characters.
- Alternatives: none obvious.
- Should the spec pin this? no.

## C-7: `validateEnvelope` order of errors
- Spec reference: OPEN-EV-001
- Situation: ambiguous (explicitly open)
- What I chose: depth-first. At each object, `unknown_member` errors come first, then the spec's members in table order (`required` or the member's own errors), then object-level checks such as the proximity rule's "exactly one of".
- Alternatives: sort by path.
- Should the spec pin this? no, the suite compares errors without regard to order.

## C-8: Point on the boundary uses exact arithmetic
- Spec reference: REQ-RP-003, OPEN-RP-001
- Situation: missing (tolerance is open)
- What I chose: a point is on an edge when the cross product is exactly 0 in binary64 and the point lies in the segment's bounding box. There is no tolerance. Interior points use even-odd ray casting.
- Alternatives: a 1e-9 tolerance like the earlier verifier.
- Should the spec pin this? no. The spec already leaves it open.

## C-9: `stop` records with `applied.target`
- Spec reference: REQ-RP-001 step 5, REQ-RP-004
- Situation: ambiguous
- What I chose: a `target` on a `stop` record is never judged for the keep-in or keep-out polygons, and is always reported as unchecked, as REQ-RP-004 says. Other unchecked rules apply equally to all three decisions.
- Alternatives: judge it anyway.
- Should the spec pin this? no.

## C-10: MISSING_REASON is checked even when `applied` is not an object
- Spec reference: REQ-RP-001 steps 4 and 7
- Situation: ambiguous
- What I chose: step 4 skips only steps 5 and 6, so step 7 still runs. `REJECT_APPLIED` likewise does not skip step 7. `UNKNOWN_DECISION` skips everything after it.
- Alternatives: stop at the first structural finding.
- Should the spec pin this? no, the text is clear; I record it because it is easy to misread.

## C-11: Non-JSON-object `input` inside `run`
- Spec reference: REQ-IF-007
- Situation: ambiguous
- What I chose: `input` that is an array or `null` is `bad_request`, as for any other non-object.
- Alternatives: none.
- Should the spec pin this? no.

## C-12: Driver reads all of stdin before answering
- Spec reference: REQ-IF-002
- Situation: missing
- What I chose: the driver reads all of stdin, then writes all responses at once. A final line without a trailing LF is still a request.
- Alternatives: stream line by line (needed only for an interactive peer; the spec only requires ordered responses and exit 0 at EOF).
- Should the spec pin this? unsure. A peer that waits for a response before sending the next request would hang. The spec says "reads until end of file" only implicitly.

## C-13: Command-line output and stderr
- Spec reference: REQ-CL-004, OPEN-CL-001
- Situation: missing (open)
- What I chose: without `--json`, one summary line on stdout. Usage errors and unusable input print a short message to stderr and nothing to stdout.
- Alternatives: a per-finding listing.
- Should the spec pin this? no.

## C-14: Command-line option parsing details
- Spec reference: REQ-CL-001, OPEN-CL-003
- Situation: ambiguous
- What I chose: `--head`'s next argument is its value whatever it looks like. A repeated `--head` takes the last value. Single-dash arguments such as `-x` count as file paths. All usage checks happen before any file is opened. An unknown `--` option is a usage error even when the files are fine.
- Alternatives: reject single-dash arguments.
- Should the spec pin this? no, it is open.

## C-15: File decoding on the command line
- Spec reference: REQ-CL-002, OPEN-CL-002
- Situation: ambiguous
- What I chose: files are decoded as strict UTF-8 (invalid bytes give exit 3). A leading byte order mark makes `JSON.parse` fail, so such a file gets exit 3.
- Alternatives: strip the BOM.
- Should the spec pin this? no, it is open.

## C-16: Stdin decoding
- Spec reference: OPEN-IF-003
- Situation: missing (open)
- What I chose: lenient decoding, invalid bytes become U+FFFD, and a BOM is kept (it makes the first line fail to parse, giving `bad_request`).
- Alternatives: strict decoding.
- Should the spec pin this? no.

## C-17: Duplicate member names and `__proto__`
- Spec reference: OPEN-IF-002
- Situation: missing (open)
- What I chose: `JSON.parse` keeps the last duplicate. A member named `__proto__` is an ordinary own property, and all lookups use own properties only.
- Alternatives: none.
- Should the spec pin this? no.

## C-18: Record checks accept `seq` beyond 2^53
- Spec reference: REQ-CH-001
- Situation: ambiguous
- What I chose: "non-negative integer" is `Number.isInteger(seq) && seq >= 0` on the binary64 value, so `1e20` is accepted. `SEQ_GAP` uses `previous + 1` in binary64.
- Alternatives: cap at 2^53.
- Should the spec pin this? no.

## C-19: Replay when `decision` is not a string
- Spec reference: REQ-RP-001 step 2
- Situation: ambiguous
- What I chose: any value that is not exactly one of the four strings, including missing, is `UNKNOWN_DECISION`.
- Alternatives: none.
- Should the spec pin this? no.

## C-20: Pointer paths for array elements
- Spec reference: REQ-EV-001
- Situation: ambiguous
- What I chose: element index in decimal with no padding (`/workspace/keep_in/2/0`).
- Alternatives: none.
- Should the spec pin this? no.
