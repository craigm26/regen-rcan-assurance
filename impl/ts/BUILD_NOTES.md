# Build notes

## Layout
- `lib.ts`: canonical JSON, hashes, envelope validation, chain, authority audit, replay.
- `driver.ts`: line-oriented driver (`handle(line)` is exported for tests).
- `verify.ts`: command line (`main(argv)` is exported).
- `spec.test.ts`: tests, one or more per MUST.
- `REGEN.json`: `build` is empty; `test` is `node --test`; `driver` is `node driver.ts`; `cli` is `node verify.ts`.

## Build, test, run
- No build step. Node 22.18 or later strips the types itself.
- Test: `node --test`.
- Driver: `node driver.ts < requests.jsonl`.
- Command line: `node verify.ts verify <chain.json> [<envelope.json>] [--json] [--head <hash>]`.

## Budget
- Implementation source is 314 non-blank lines (`lib.ts` 212, `driver.ts` 49, `verify.ts` 53), under the 500 limit. The test file is not counted.

## Things that surprised me
- `JSON.parse` already matches the spec's number and string rules. It rounds numbers to binary64, turns `1e400` into infinity, rejects `NaN`, and keeps lone surrogates from `\ud800` escapes. `String(number)` is the ECMAScript algorithm the spec asks for, and default `sort()` compares UTF-16 code units. So the canonical writer is short.
- `JSON.stringify` turns infinity into `null`. My first tests built `1e400` through it and got the wrong result, so the tests send raw text for those cases.
- A tampered record does not produce `PREV_MISMATCH` on the next record when only its other members changed. REQ-CH-002 says the previous record's `hash` is used as written, so only `HASH_MISMATCH` is reported.
- The sandbox refused some shell forms (heredocs and pipes). I created files with the file-writing tool and ran only `node --test`.
- `git init` was not run, because the work was not requested as a commit.
- 17 judgement calls are in CHOICES.md.
