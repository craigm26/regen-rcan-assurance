# Secondary reference adapter: the Python port

The earlier Python SDK contains a hand port of the earlier verifier, whose docstring says its
finding codes, hashing and edge cases match the earlier TypeScript verifier "so the two
verifiers agree on the same chain". This adapter runs the suite against that port, as a second
data point for r00 (ledger `r00-port`). It contains no code from the SDK. `local.json`
(gitignored) names the pristine clone: `{ "sdk": "<clone root>" }`.

Run: `node .regenerate/suite/run.mjs --impl .regenerate/suite/adapters/port-py --reference --na validateEnvelope,cli,if-regen`

- The port has no envelope validator and no command line: those cases are n/a.
- Requests are parsed as the port's users would parse JSON (Python's `json.loads` defaults, so
  integers stay exact), except that `NaN` and `Infinity` make a line a bad request.
- Request-level errors are answered by the adapter, as in the main reference adapter.
- A `UnicodeEncodeError` (the port refusing a string with no UTF-8 form) is reported as
  `invalid_string`; any other exception as the non-spec error `reference_threw`.
