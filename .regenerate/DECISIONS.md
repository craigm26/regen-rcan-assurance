# assurance-verify: decisions

Why the specification says what it says. Each entry names what forced a decision and what else
was possible. "The earlier verifier" is the implementation this specification was extracted
from; "the earlier SDKs" are two libraries, one in TypeScript and one in Python, that already
produced canonical JSON for the same protocol.

## D-001: Scope is evidence, not machines
- Source: extraction
- Context: Appendix C defines an envelope, a gate_decision record, assurance levels A1–A3 and
  nine tests (EV-01 to EV-09), most of which need a physical machine.
- Decision: the program covers what a third party can check with only the log and the
  envelope: canonical bytes, hashes, envelope form (§ 4), chain linkage (§ 5), the authority
  audit (§ 6) and replay (§ 7). That is EV-08 and the log half of EV-07.
- Why: those are the checks that need nothing but files, so two independent implementations can
  be compared on them exactly.
- Alternatives: include signature verification (see D-002); include a simulated gate (that is
  the machine, not the evidence).

## D-002: Signatures are not verified
- Source: extraction
- Context: an envelope carries an integrator `signature`; the protocol's current signing profile
  is a hybrid of a post-quantum scheme and Ed25519.
- Decision: the signature is only checked for form (REQ-EV-004) and removed before hashing
  (REQ-HA-002). It is never cryptographically verified.
- Why: the post-quantum half needs cryptography outside the standard libraries this program is
  limited to (REQ-BU-002), and the example envelopes carry placeholder signatures.
- Alternatives: verify only the Ed25519 half (a partial check that would read as a full one).

## D-003: Member names sort by UTF-16 code units
- Source: extraction
- Context: the protocol's canonical-JSON rules say members are sorted "lexicographically
  (Unicode code-point order)" and, in the same section, that the scheme "matches RFC 8785". RFC
  8785 sorts by UTF-16 code units. The two orders differ only when names mix characters outside
  the Basic Multilingual Plane with characters in U+E000–U+FFFF. The earlier verifier sorts by
  UTF-16 code units. The earlier TypeScript SDK sorts the same way, but then rebuilds an object
  before writing it, and its language writes names that look like array indices (`"9"`,
  `"10"`) first, in numeric order. The earlier Python SDK sorts by code point. The protocol's
  12 canonical test vectors contain no name that tells any of these apart.
- Decision: UTF-16 code units, comparing every name as a string (REQ-CJ-001), with examples in
  § 2.6 and suite cases that separate the orders.
- Why: it is what RFC 8785 says, what the earlier verifier does, and what makes hashes agree
  with it. The protocol's two claims cannot both hold; this picks the one that is a published
  standard.
- Alternatives: code-point order (simpler in some languages, but disagrees with RFC 8785).

## D-004: Numbers are binary64 and written as ECMAScript writes them
- Source: extraction
- Context: the earlier verifier writes numbers with JavaScript's own number-to-text conversion.
  The earlier Python SDK writes them with Python's, after turning whole floats into integers.
  The two agree on every protocol test vector, and disagree on values the vectors do not cover:
  `1e-7` against `1e-07`, `0.000001` against `1e-06`, `1e21` against
  `1000000000000000000000`, and integers above 2^53, which one rounds to binary64 and the other
  keeps exactly.
- Decision: every number is the binary64 value nearest its text (REQ-IF-006). It is written by
  the ECMAScript algorithm, which REQ-CJ-003 restates step by step, as RFC 8785 requires.
- Why: RFC 8785 defines numbers this way, and the earlier verifier's hashes depend on it.
- Alternatives: keep large integers exact (better fidelity, but not RFC 8785, and the hashes
  would differ from the earlier verifier's).

## D-005: Non-finite numbers are an error, not `null`
- Source: extraction
- Context: the earlier verifier writes infinity and NaN as `null` without complaint, because
  that is what its language's JSON writer does. The earlier Python SDK would write `Infinity`,
  which is not JSON at all. JSON text cannot express them, but `1e400` overflows to infinity
  when read.
- Decision: `non_finite_number` (REQ-CJ-004).
- Why: RFC 8785 § 3.2.2.3 says NaN and Infinity MUST make a conforming implementation stop with
  an error. Silently hashing `null` in their place means two different documents share a hash.
- Alternatives: write `null` as the earlier verifier does (compatible, but wrong).

## D-006: Unpaired surrogates are an error
- Source: extraction
- Context: JSON text may contain `\ud800`, which reads as a string that has no UTF-8 encoding.
  The earlier verifier writes such a string as the six-character escape `\ud800`, because that
  is what its language's JSON writer does.
- Decision: `invalid_string` (REQ-CJ-005).
- Why: RFC 8785 § 3.2.2.2 says such data MUST make a conforming implementation stop with an
  error. Escaping it gives the value canonical bytes that a conforming implementation never
  produces.
- Alternatives: replace it with U+FFFD (changes the value silently); write the escape, as the
  earlier verifier does.

## D-007: Envelope rules restated; four error codes
- Source: extraction
- Context: the protocol publishes the envelope's rules as a JSON Schema (2020-12), and the
  earlier tooling validated envelopes with a general JSON Schema engine, which reports errors in
  that engine's own vocabulary.
- Decision: § 4 restates every rule of that schema directly. Errors are a JSON Pointer path plus
  one of four codes (`type`, `required`, `unknown_member`, `invalid_value`). Their order is open.
  No JSON Schema engine is needed.
- Why: the path is what tells a person where an envelope is wrong. Engine-specific keyword names
  would tie the contract to one engine. Four codes are enough to say what kind of fix is needed.
- Alternatives: one code per JSON Schema keyword; only a valid/invalid verdict.

## D-008: Patterns are stated in words
- Source: extraction
- Context: the schema writes two rules as regular expressions (`^0\.[0-9]+$` and
  `^[a-z0-9-]+:.+$`). Regular-expression dialects disagree on exactly these things: whether `$`
  matches before a trailing newline, and which characters `.` excludes.
- Decision: REQ-EV-004 states both rules in words. `envelope_version` allows no trailing
  newline. The part of `signature` after the colon may not contain LF, CR, U+2028 or U+2029,
  which is what the schema's own dialect (ECMAScript) means by `.`.
- Why: a rule two correct implementations can read differently is not a rule.
- Alternatives: quote the regular expressions and name the dialect.

## D-009: Chain operations require a minimal record shape
- Source: extraction
- Context: the earlier verifier assumes every record has a numeric `seq` and string `prev` and
  `hash`, and computes with missing values if they are absent.
- Decision: REQ-CH-001 makes that shape a precondition (`bad_request` otherwise; exit status 3
  on the command line). A record's `t` is not checked: Appendix C asks for `seq` to be monotonic
  and contiguous, says nothing of the kind about `t`, and the earlier verifier ignores it.
- Why: a finding such as `SEQ_GAP` only means something when `seq` is a number. A record that
  fails the precondition is not evidence of anything.
- Alternatives: report a per-record `MALFORMED` finding and carry on (more forgiving, but
  harder to specify how the following records are judged).

## D-010: The tail is never claimed complete without an anchor
- Source: extraction
- Context: Appendix C states that a hash chain cannot detect records removed from its end
  unless the last hash is anchored elsewhere. The earlier verifier takes an optional anchor in
  its library, but not on its command line.
- Decision: `verifyChain` returns `tail` = `"anchored"` or `"unverified"` (REQ-CH-003,
  REQ-CH-004), and the command line takes `--head` (REQ-CL-001).
- Why: a clean result on an unanchored chain must not read as "the whole log is here".
- Alternatives: report only findings, as the earlier verifier does, and leave the limit to the
  documentation.

## D-011: Authority means a non-empty string
- Source: extraction
- Context: the earlier verifier tests `principal` and `authority` for truthiness in its own
  language, so the number `5` passes and the number `0` fails.
- Decision: REQ-AA-002 requires a non-empty string.
- Why: the record format defines both as strings. Truthiness is a property of one language, not
  of the evidence.
- Alternatives: keep the truthiness rule (it would need restating per language).

## D-012: Replay checks the decision table as well as the bounds
- Source: extraction
- Context: Appendix C's decision table says an `allow` applies the command unchanged, and that
  `clamp`, `reject` and `stop` carry a `reason`. The record schema requires `applied` to be an
  object for `allow`, `clamp` and `stop`. The earlier verifier checks the bounds, `reject`'s
  `null` and `stop`'s zero velocity, but none of the following:
  - that an `allow` left the command unchanged
  - that a reason is present
  - that `applied` is an object
  - that `decision` is one of the four values
- Decision: four more findings: `ALLOW_MODIFIED`, `MISSING_REASON`, `APPLIED_NOT_OBJECT` and
  `UNKNOWN_DECISION` (REQ-RP-001).
- Why: each is a sentence in the evidence format that a third party would expect a verifier to
  hold the log to.
- Alternatives: keep the earlier verifier's narrower set and leave these to schema validation of
  each record (a separate step nobody is guaranteed to run).

## D-013: Point-in-polygon includes the boundary
- Source: extraction
- Context: the earlier verifier treats a point on an edge as inside, for both keep-in and
  keep-out polygons, using a small tolerance for "on".
- Decision: boundary points are inside (REQ-RP-003). The tolerance and self-intersecting
  polygons are open (OPEN-RP-001); the suite uses only points exactly on or clearly off an edge.
- Why: inclusive is the conservative reading for keep-out (touching a forbidden zone is a
  finding) and the generous one for keep-in (touching the edge of the workspace is allowed).
  That pairing is what the earlier verifier does.
- Alternatives: exclusive boundaries (a keep-out edge would become reachable).

## D-014: Unchecked fields are reported by name, sorted
- Source: extraction
- Context: the earlier verifier understands one command shape (`linear_mps`, `angular_radps`,
  `target`), and reports every other member name of `applied` as unjudged instead of passing it
  silently. A known name whose value it cannot use (a speed written as a string, a one-element
  target) is either ignored without a word or compared after its language's type coercion. It
  lists names in the order they first appear, and some JSON readers do not keep the text's
  member order (JavaScript objects put integer-like names first).
- Decision: `UNCHECKED_FIELDS` with a `field` member (REQ-RP-004). A member counts as judged
  only when replay can use its value; every other member is unchecked, including a `target` on
  a `stop` record, which replay never looks at. Names are sorted by UTF-16 code units. It is
  not a failure (REQ-CL-003).
- Why: silence must not read as a pass, which is Appendix C's own wording, and a field replay
  cannot judge is the same whether its name is unknown or its value is unusable. Sorting removes
  any dependence on how a JSON reader orders members.
- Alternatives: first-appearance order (depends on the reader); fail on unknown fields (would
  make every richer command shape a failure).

## D-015: Command-line exit status separates findings from bad input
- Source: extraction
- Context: the earlier verifier's command line exits 1 both when it finds problems and when a
  file cannot be read (as an uncaught error), and has no machine-readable output.
- Decision: statuses 0, 1, 2 and 3 (REQ-CL-003), and `--json` (REQ-CL-004). The command line
  also validates the envelope when one is given. An argument starting with `--` is an option;
  single-dash arguments and repeated options are open (OPEN-CL-003), because nothing depends on
  them.
- Why: a script that drives a verifier needs to tell "the evidence is bad" from "the verifier
  could not read the evidence".
- Alternatives: keep a single failure status.

## D-016: Findings compare on seq, code and field
- Source: extraction
- Context: the earlier verifier attaches human-readable detail to every finding.
- Decision: the detail text is open (OPEN-CH-001). The suite compares the ordered list of `seq`,
  `code` and `field`.
- Why: the code says what is wrong and `seq` says where; wording is for people.
- Alternatives: pin the detail text (it would pin one implementation's phrasing).

## D-017: Replay uses only well-typed bounds, polygons and targets
- Source: extraction (r00)
- Context: the earlier verifier compares whatever values it finds, so its language's type
  coercion decides the result. A speed limit written as the string `"0.5"` is compared as a
  number; a two-point keep-out "polygon" catches targets lying on its one segment; a target
  `["99", 1]` is tested against the workspace.
- Decision: replay uses a bound only if it is a number, a keep-in or keep-out polygon only if
  it has at least three points, and a target only if it is two finite numbers (REQ-RP-001,
  REQ-RP-002). Anything else is skipped, and a skipped target is reported as unchecked
  (REQ-RP-004). Judging the envelope's form is § 4's job, and the command line always runs both.
- Why: coercion belongs to one language. A rule that implementations in different languages can
  follow exactly has to name types.
- Alternatives: treat a malformed keep-in polygon as empty, so that every target is outside
  (safe for replay on its own, but it repeats § 4's verdict as one finding per record).

## D-018: Absent and null are different
- Source: extraction
- Context: the earlier verifier's canonical writer drops members whose value is its language's
  `undefined`, a value JSON cannot express. In other languages an absent member and a member
  holding null are easy to conflate, and the earlier Python SDK's port of the verifier does: it
  passes a `reject` record that has no `applied` member, which the earlier verifier flags.
- Decision: every value comes from JSON text, so a member is either present (possibly `null`)
  or absent. Canonical JSON writes `"k":null` for a null member and nothing for an absent one.
  Where the difference matters, the specification says which applies: `reject` needs an
  `applied` member whose value is `null` (REQ-RP-001 step 3); a missing `cmd` counts as `null`
  for `ALLOW_MODIFIED` (step 6.4); a missing `authority` and a null one both fail REQ-AA-002.
- Why: hashes depend on it.
- Alternatives: none that keep hashes the same across implementations.

## D-019: Requests and input files are strict JSON; lines split at LF only
- Source: primary source (RFC 8259)
- Context: some JSON readers accept `NaN` and `Infinity` as numbers by default, and some line
  readers end a line at a lone CR as well as at LF.
- Decision: a line or file containing `NaN`, `Infinity` or anything else outside RFC 8259 is not
  JSON (REQ-IF-006): `bad_request` with a null `id`, or exit status 3 on the command line.
  Standard input is UTF-8 and splits into lines at LF only; CR is JSON whitespace (REQ-IF-002).
- Why: two drivers must answer the same bytes the same way.
- Alternatives: accept a reader's extensions (the answer would depend on the reader).

## D-020: Duplicate authority kinds compare as strings
- Source: extraction
- Context: the protocol's schema marks `required_for` as unique items, which compares every
  element, including elements that are not strings and are therefore already errors.
- Decision: REQ-EV-007 compares only the string elements, as strings. Non-strings get `type`
  and take no part.
- Why: comparing arbitrary values needs their canonical forms, and a value such as `1e400` has
  none, which would turn an envelope report into an operation error. Validation should always
  answer.
- Alternatives: compare canonical forms of every element (the schema's rule).

## D-021: What the driver does with bytes that are not UTF-8 is open
- Source: r01
- Context: the first blind build decoded standard input leniently (invalid bytes become
  U+FFFD) and asked whether the spec should say what happens to invalid UTF-8 or a byte order
  mark on standard input.
- Decision: OPEN-IF-003. The suite only sends valid UTF-8 without a byte order mark. Input files
  for the command line stay pinned: a file that is not UTF-8 JSON text is bad input (status 3).
- Why: nothing that drives the program sends such bytes, and a rule for them would only add
  cases. Files are different, because they come from outside and a verifier must not guess at
  evidence.
- Alternatives: `bad_request` with a null `id` for any line that is not valid UTF-8.

## D-022: Resource limits are open
- Source: r02
- Context: the second blind build answered `bad_request` when very deep nesting overflowed its
  stack, and noted that no error category fits an internal failure.
- Decision: OPEN-IF-004. The suite never nests values more than a few levels deep. Evidence
  records and envelopes are shallow by their nature.
- Why: a pinned limit would be a number nothing depends on, and every language's recursion
  limit differs.
- Alternatives: pin a depth (for example 1,000) and an error category for exceeding it.

## D-023: The driver may read all of its input before answering
- Source: r03
- Context: the third build reads standard input to the end before writing any response, and
  noted that a caller that waits for each response before sending the next request would hang.
- Decision: OPEN-IF-005. The suite sends every request, closes standard input, then reads.
- Why: nothing drives the program interactively, and streaming adds code that no case can
  tell from batching.
- Alternatives: require one response per line as soon as the line is read.

## D-024: Sequence numbers above 2^53 are open
- Source: r04
- Context: `seq` is a binary64 value (REQ-IF-006), so above 2^53 `seq + 1` can equal `seq`, and
  a gap there can go unreported. The fourth build pointed this out.
- Decision: OPEN-CH-002.
- Why: a chain long enough to need such numbers does not exist, and exact integer arithmetic
  would contradict REQ-IF-006 for every other number.
- Alternatives: require exact integer arithmetic for `seq` only.

