# regen-rcan-assurance

An independent verifier for RCAN Appendix C evidence (canonical JSON, envelope rules,
hash-chained gate decisions), rebuilt by agents from a spec.

The durable asset is [`.regenerate/`](.regenerate/): the specification, the decisions behind it,
a suite that judges any implementation from the outside, and a ledger of every build. The code in
[`impl/`](impl/) is output: each tree was written by an agent that was shown only the spec, and
CI checks that it is byte for byte what that logged run produced. The story is in
[WRITEUP.md](WRITEUP.md).

## What the program does

`assurance-verify` checks the evidence a robot's safety gate leaves behind. It does not check
a robot, and a clean result says nothing about whether a machine behaved as its log claims.

- **Canonical JSON** (RFC 8785) and `sha256:` hashes of envelopes and records
- **Envelope validation:** every rule of the Appendix C envelope schema, with JSON Pointer error
  paths
- **Chain verification:** sequence, `prev` linkage and per-record hashes. With `--head`, the tail
  is checked against an anchor; without one, the result says the tail is unverified.
- **Authority audit:** every executed, authority-gated command names a principal and an
  authority
- **Replay:** every applied command against the envelope's speed, turn and workspace limits,
  plus the decision table (an `allow` applies the command unchanged; `clamp`, `reject` and
  `stop` give a reason). Fields it cannot judge are reported by name, never passed silently.

```
node impl/ts/verify.ts verify chain.json envelope.json --json      # Node 22.18+
python3 impl/py/cli.py verify chain.json envelope.json --head sha256:…
```

Exit status: 0 clean, 1 findings or an invalid envelope, 2 usage error, 3 unreadable input.
Both implementations also speak the suite's line protocol (`driver.ts`, `driver.py`), which is
how the suite talks to them.

## Releases

| Language | Folder | Built by | Spec tag | Suite at its tag | Lines |
|---|---|---|---|---|---|
| TypeScript (Node 22.18+, no dependencies) | `impl/ts` | r03 | `spec-v1.0.2` | 468/468 | 313 |
| Python (3.11+, standard library) | `impl/py` | r04 | `spec-v1.0.2` | 468/468 | 455 |

`main` carries `spec-v1.0.3`: two more open items, one wording fix and one new case, from the
notes of r03 and r04. No build has been made from it; both released trees pass its suite.

## Regenerating it

1. Copy `SPEC.md`, `DECISIONS.md` and `PROMPT.<lang>.md` (renamed `PROMPT.md`) from a spec tag into
   an empty folder, and run `node .regenerate/tools/leak-check.mjs <folder>`.
2. Launch a builder with `.regenerate/tools/launch-blind.sh <sandbox> <model> <lang>`. It starts
   Claude Code with file tools confined to the folder, no web or MCP tools, a shell allowlist and
   an allow-listed environment.
3. Audit the transcript (`audit-transcript.mjs`), then score the output against the tag's suite:
   `node .regenerate/tools/score.mjs --impl <output> --suite .regenerate/suite`.
4. Any implementation, in any language, can be judged the same way:
   `node .regenerate/suite/run.mjs --impl <folder with REGEN.json>`.

The protocol these steps come from, and the brief for this project, live outside the repo; the
record of what happened is in `.regenerate/PROVENANCE.md`, `.regenerate/runs/` and
`.regenerate/ledger.jsonl`.

## Credits and license

- The specification restates rules from the [RCAN specification](https://rcan.dev)
  ([rcan-spec](https://github.com/RobotRegistryFoundation/rcan-spec) @ `16fc1a4`), Appendix C and
  the audit-bundle canonical JSON rules, and from RFC 8785. The test fixtures in
  `.regenerate/suite/fixtures/` are copied unchanged from rcan-spec, whose specification text is
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- The earlier verifier the suite was first run against is rcan-spec's
  `scripts/assurance/evidence-chain.ts`. No code from it, or from the rcan-ts and rcan-py SDKs, is
  in this repository; the adapters load it from a local clone.
- The `.regenerate/` layout follows Carson Farmer's
  [iroh-acp-go](https://github.com/carsonfarmer/iroh-acp-go); the method follows Chad Fowler's
  [writing on regenerative software](https://chadfowler.com/regenerative-software/).
- Code in this repository: MIT (see LICENSE).
