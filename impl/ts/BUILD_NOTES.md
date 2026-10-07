# Build notes

- Layout: `lib.ts` (all logic), `driver.ts` (line protocol), `verify.ts` (command line), `spec.test.ts` (tests). About 313 non-blank source lines, under the 500 budget. No dependencies and no build step; Node 22.18+ strips the types.
- Build: nothing to build (`build` is empty in REGEN.json).
- Test: `node --test` (or `npm test` is not available because there is no package.json).
- Run the driver: `node driver.ts < requests.jsonl`
- Run the command line: `node verify.ts verify <chain-file> [<envelope-file>] [--json] [--head <hash>]`

## Surprises
- The file-writing tool turned U+2028 and U+2029 escapes in a regex literal into raw characters, which broke TypeScript's type stripping ("Unterminated regexp literal"). The signature rule is now written with a code-unit check instead of a regex literal.
- `JSON.parse`, `String(number)` and `JSON.stringify` already give the RFC 8785 number and string forms, including lowercase `\u00xx` escapes and well-formed surrogate handling (`isWellFormed`). Sorting keys with the default `sort()` compares UTF-16 code units, which is what REQ-CJ-001 needs.
- A test helper that passed `expectedHead: undefined` showed that a present member and an absent one differ; JSON text cannot say "undefined", so the driver never sees it.
- Tests were not run on Windows.
