# Build notes

## Layout
- `lib.ts`: canonical JSON, hashes, envelope validation, chain, authority, replay, and the driver operation table.
- `driver.ts`: line-oriented driver (`node driver.ts`).
- `verify.ts`: command line (`node verify.ts verify <chain> [<envelope>] [--json] [--head <hash>]`).
- `verify.test.ts`: tests, at least one per MUST.
- `REGEN.json`: `build` is empty, `test` is `node --test`, `driver` is `node driver.ts`, `cli` is `node verify.ts`.

## Build, test, run
- No build step. Node 22.18+ runs the `.ts` files directly by type stripping (tested on 22.22).
- Test: `node --test` from this folder. All 15 tests pass.
- Driver: `echo '{"id":"1","op":"canonical","input":{"value":{"b":1,"a":2}}}' | node driver.ts`
- CLI: `node verify.ts verify chain.json envelope.json --json`

## Size
Source is well under the 500 non-blank line budget. A test checks this and checks that imports are only relative or `node:`.

## Surprises
- Writing the characters U+2028/U+2029 as ` ` escapes in source text got turned into raw characters on disk, which broke a regex literal ("Unterminated regexp literal"). The signature rule now builds those two characters with `String.fromCharCode`, so no raw line terminator is in `lib.ts`.
- The JS engine already gives most of RFC 8785: `String(number)` is the required number form (and writes `-0` as `0`), the default `sort()` compares UTF-16 code units, and `JSON.stringify` on a string gives the required escapes in lowercase. `isWellFormed()` finds unpaired surrogates.
- Per the spec, `{"id":"b"}` (string id, no `op`) is `unknown_op`, not `bad_request`.
- A `CHOICES.md` entry records a stray empty `tmp_ok/` directory I could not remove with the allowed commands.
