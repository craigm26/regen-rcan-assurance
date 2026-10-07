# Choices

## C-1: Near-boundary tolerance in point-in-polygon
- Spec reference: REQ-RP-003, OPEN-RP-001
- Situation: ambiguous
- What I chose: a point within 1e-9 (Euclidean distance to a segment) of an edge counts as on it; otherwise even-odd ray casting.
- Alternatives: exact arithmetic only; a relative tolerance.
- Should the spec pin this? no, it is already declared open.

## C-2: Input file starting with a byte order mark
- Spec reference: OPEN-CL-002
- Situation: ambiguous
- What I chose: the BOM is kept by the decoder, so JSON parsing fails and the exit status is 3.
- Alternatives: strip the BOM and accept the file.
- Should the spec pin this? no, evidence files are best rejected rather than guessed at.

## C-3: Invalid UTF-8 in a CLI input file
- Spec reference: REQ-CL-002 (step 1), D-021
- Situation: missing
- What I chose: the file is decoded strictly; invalid bytes give exit status 3.
- Alternatives: lenient decoding with U+FFFD.
- Should the spec pin this? unsure. D-021 says files are pinned, but REQ-CL-002 only says "UTF-8 JSON text".

## C-4: Invalid UTF-8 or a BOM on driver standard input
- Spec reference: OPEN-IF-003
- Situation: ambiguous
- What I chose: lenient decoding (invalid bytes become U+FFFD). Node's `Buffer.toString('utf8')` keeps a BOM as part of the first line, so that line is `bad_request` with a null id.
- Alternatives: strict decoding with `bad_request` per bad line.
- Should the spec pin this? no.

## C-5: Options and arguments the spec calls open
- Spec reference: OPEN-CL-003
- Situation: ambiguous
- What I chose: a lone `-x` argument is a file path. A repeated option is allowed and the last `--head` wins. A `--head` value starting with `--` is taken as the value, since it is the argument after `--head`.
- Alternatives: treat single-dash arguments as usage errors; reject repeats.
- Should the spec pin this? no.

## C-6: Output without --json and on exit status 2/3
- Spec reference: OPEN-CL-001
- Situation: ambiguous
- What I chose: a short human summary on stdout (`OK`/`FAIL`, then one line per envelope error and finding). Usage and input errors write one line to stderr, nothing to stdout.
- Alternatives: print the JSON object always.
- Should the spec pin this? no.

## C-7: Findings carry no `detail`
- Spec reference: REQ-CH-005, OPEN-CH-001
- Situation: ambiguous
- What I chose: never emit `detail`.
- Alternatives: add explanatory text.
- Should the spec pin this? no.

## C-8: Unexpected internal exception in the driver
- Spec reference: REQ-IF-007
- Situation: missing
- What I chose: any exception that is not an `OpError`, such as a stack overflow from very deep nesting, answers `bad_request` for that line and the driver continues.
- Alternatives: crash; a new error category.
- Should the spec pin this? unsure. The category list is closed, and no category fits an internal failure.

## C-9: `-0` and non-finite values as `seq`
- Spec reference: REQ-CH-001
- Situation: ambiguous
- What I chose: `seq` must be a finite integer ≥ 0, and `-0` is accepted (it is not less than 0) and printed as `0`. `1e400` is not an integer, so it gives `bad_request`.
- Alternatives: reject `-0`.
- Should the spec pin this? no.

## C-10: Which values count as "number" in replay
- Spec reference: REQ-RP-001, REQ-RP-002, REQ-RP-004
- Situation: ambiguous
- What I chose: for `linear_mps`, `angular_radps` and the bounds, "a number" is any binary64 value including ±infinity (so `1e400` is a number and exceeds any finite bound, and is judged rather than unchecked). For `target`, "point" requires finite numbers, as § 7 states.
- Alternatives: require finite numbers everywhere.
- Should the spec pin this? yes. EV-003 defines "number" as finite but § 7 does not repeat it.

## C-11: Canonical errors in `replay`
- Spec reference: REQ-IF-007 step 4
- Situation: ambiguous
- What I chose: the envelope is canonicalized first and always, even for an empty record list. Then `applied` and `cmd` are canonicalized only for `allow` records that reach step 6.4, so a bad `cmd` in an `allow` record is an error even when `applied` is fine. A `cmd` in other decisions is never touched.
- Alternatives: lazily skip `cmd` when `applied` already differs. The table says both are canonicalized, so I did not.
- Should the spec pin this? no.

## C-12: Bounds read through non-object containers
- Spec reference: REQ-RP-002
- Situation: missing
- What I chose: `envelope.motion`, `envelope.workspace` and `envelope.authority` are read only when they are JSON objects (not arrays). Members are read as own properties only (so a key like `__proto__` is just data).
- Alternatives: index into arrays.
- Should the spec pin this? no.

## C-13: Sparse use of the 1e-9 tolerance for degenerate edges
- Spec reference: REQ-RP-003
- Situation: missing
- What I chose: a zero-length edge (repeated vertex) is treated as a single point for the on-edge test. Polygons with repeated vertices are otherwise handled by the same rules.
- Alternatives: skip zero-length edges.
- Should the spec pin this? no.

## C-14: Test runner command and file layout
- Spec reference: REQ-IF-001
- Situation: missing
- What I chose: `test` is `node --test`, which discovers `verify.test.ts` itself. Shared code is in `lib.ts`, with the thin entry points `driver.ts` and `verify.ts`. The 500-line budget counts all three plus nothing else.
- Alternatives: `npm test`, which needs a `package.json`; the prompt forbids dependencies but not scripts. I avoided adding one.
- Should the spec pin this? no.

## C-15: Duplicate member names
- Spec reference: OPEN-IF-002
- Situation: ambiguous
- What I chose: whatever `JSON.parse` does, which is the last value wins.
- Alternatives: reject duplicates.
- Should the spec pin this? no, it is already declared open.

## C-16: Empty directory `tmp_ok`
- Spec reference: none
- Situation: missing
- What I chose: an empty `tmp_ok/` directory was created by accident while checking the environment. The command whitelist has no `rmdir`, so it is left in place. It contains no source and affects nothing.
- Alternatives: delete it.
- Should the spec pin this? no.
