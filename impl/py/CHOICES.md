## C-1: Invalid UTF-8 on driver stdin
- Spec reference: OPEN-IF-003
- Situation: missing
- What I chose: decode stdin as UTF-8 with replacement characters; a BOM is not stripped, so a first line starting with a BOM is `bad_request` with null id.
- Alternatives: reject the line; strip the BOM.
- Should the spec pin this? no, it is already open.

## C-2: Input files with a BOM or invalid UTF-8
- Spec reference: REQ-CL-002, OPEN-CL-002
- Situation: ambiguous
- What I chose: invalid UTF-8 gives exit 3. A BOM is not JSON, so it also gives exit 3.
- Alternatives: accept a BOM.
- Should the spec pin this? no, it is already open.

## C-3: Non-JSON-object `input` members versus `null`
- Spec reference: REQ-IF-007 step 3, § 1.3
- Situation: ambiguous
- What I chose: `canonical` and `validateEnvelope` only need the member to be present (`null` is a valid value). `expectedHead: null` counts as present and not a string, so it is `bad_request`.
- Alternatives: treat `null` as absent.
- Should the spec pin this? yes, a one-line note on `null` for optional members would help.

## C-4: Number parsing and `seq` output
- Spec reference: REQ-IF-006, REQ-CH-005
- Situation: missing
- What I chose: every JSON number is parsed to a Python float. `seq` in findings is written as an integer (`3`, not `3.0`). A `seq` of infinity is not an integer, so it is `bad_request`. `-0` counts as seq 0.
- Alternatives: keep `3.0`.
- Should the spec pin this? no, the suite compares numbers by value.

## C-5: SEQ_GAP arithmetic
- Spec reference: REQ-CH-002
- Situation: ambiguous
- What I chose: `seq` and `prev seq + 1` are compared as binary64 values. Above 2^53 a gap may therefore go unnoticed.
- Alternatives: exact integer arithmetic.
- Should the spec pin this? unsure. It only matters for absurd values, but it is cheap to state.

## C-6: Order of errors in validateEnvelope
- Spec reference: OPEN-EV-001
- Situation: missing
- What I chose: for an object, unknown members first, then each listed member in table order (required or checked). Rule-wide checks come last (the proximity either/or rule, the `required_for` duplicates check, which runs before its element errors).
- Alternatives: any other order.
- Should the spec pin this? no, it is already open.

## C-7: `when` in a proximity rule
- Spec reference: REQ-EV-006
- Situation: ambiguous
- What I chose: `when` is a closed object whose only member is `human_within_m`, which is required. An empty `when` is `required` at `.../when/human_within_m`, and extra members are `unknown_member`. A non-object `when` is `type`.
- Alternatives: report `invalid_value` at `when` for the wrong member count.
- Should the spec pin this? yes, "exactly one member" could be read as a count error.

## C-8: z_range_m and other pairs
- Spec reference: REQ-EV-004, REQ-EV-005
- Situation: ambiguous
- What I chose: `z_range_m` uses the point rules (array, exactly two elements, numbers). It is not checked for min ≤ max, since the spec says the order may be anything.
- Alternatives: none really.
- Should the spec pin this? no.

## C-9: Replay with a malformed `decision`
- Spec reference: REQ-RP-001 step 2
- Situation: ambiguous
- What I chose: a `decision` that is not one of the four strings (a number, a list, missing) is `UNKNOWN_DECISION`. `ENVELOPE_MISMATCH` is still reported first. Nothing else is reported, and no unchecked-field scan is made for the record.
- Alternatives: none.
- Should the spec pin this? no.

## C-10: Missing `reason` on records where step 4 failed
- Spec reference: REQ-RP-001 steps 4 and 7
- Situation: ambiguous
- What I chose: step 4 skips only steps 5 and 6, so `MISSING_REASON` (step 7) is still reported for `clamp` and `stop` records whose `applied` is not an object.
- Alternatives: skip step 7 too.
- Should the spec pin this? no. The text is clear and my reading follows it literally.

## C-11: Non-text output of the CLI
- Spec reference: OPEN-CL-001
- Situation: missing
- What I chose: a short plain-text summary on stdout, an error line on stderr for exit 3, and a usage line on stderr for exit 2.
- Alternatives: any.
- Should the spec pin this? no.

## C-12: Option handling in the CLI
- Spec reference: OPEN-CL-003
- Situation: missing
- What I chose: a single-dash argument such as `-x` is treated as a file path. Repeated `--json` is harmless. A repeated `--head` keeps the last value. The `--head` value is taken as the next argument whatever it looks like.
- Alternatives: usage error.
- Should the spec pin this? no, it is already open.

## C-13: Library layout
- Spec reference: OPEN-LIB-001, REQ-BU-001
- Situation: missing
- What I chose: `lib.py` holds all the logic, `driver.py` and `cli.py` are thin. Everything is in the folder root, and the line budget counts all three (about 480 lines, tests excluded). There is a Budget test for this.
- Alternatives: a package.
- Should the spec pin this? no.

## C-14: Deep nesting
- Spec reference: OPEN-IF-004
- Situation: missing
- What I chose: a RecursionError while parsing or canonicalizing becomes `bad_request` (driver) or exit 3 (CLI).
- Alternatives: none.
- Should the spec pin this? no, it is already open.

## C-15: Geometry arithmetic
- Spec reference: REQ-RP-003, OPEN-RP-001
- Situation: ambiguous
- What I chose: point-in-polygon runs in exact rational arithmetic (`fractions.Fraction` of the binary64 values). "On the edge" is exact, with no tolerance, and the interior test is even-odd ray casting.
- Alternatives: floating point with a tolerance.
- Should the spec pin this? no.

## C-16: Records for auditAuthority with a non-string `decision`
- Spec reference: REQ-AA-001
- Situation: ambiguous
- What I chose: a non-string `decision` is not an executed command, so it is skipped.
- Alternatives: none.
- Should the spec pin this? no.
