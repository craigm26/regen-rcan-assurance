# Reference adapter

Makes the earlier implementation (built outside this repo) speak the suite's driver protocol and
command line, so the suite can run against it (`r00`). It contains no code from that
implementation. It loads three things named in `local.json`, which is gitignored because the
paths are absolute:

```json
{
  "verifier": "<pristine clone>/scripts/assurance/evidence-chain.ts",
  "schema":   "<pristine clone>/schemas/envelope.json",
  "ajv2020":  "<scratch install>/node_modules/ajv/dist/2020.js"
}
```

The scratch install is `npm init -y && npm install ajv@8.20.0` in an empty folder (the version
the earlier project's `pnpm-lock.yaml` pins). Envelopes are validated the way the earlier
project's own test does: Ajv 2020-12 with `{ allErrors: true, strict: true }`.

Run: `node .regenerate/suite/run.mjs --impl .regenerate/suite/adapters/reference --reference`

What the adapter does, and does not do:

- It answers request-level errors (REQ-IF-007 steps 1 to 3, without the § 5.1 record-shape
  check) itself, because the earlier implementation has no request protocol. Those cases
  therefore test the adapter, not the reference, and say nothing about it.
- It does not repair behavior. Whatever the earlier code returns is passed on; when it throws,
  the response is the non-spec error `reference_threw`.
- It translates two output formats: validateEnvelope errors keep the engine's keyword names
  (only `valid` is compared in `--reference` mode), and the unchecked field name, which the
  earlier replay only puts in its detail text, is copied into `field`.
- `cli.mjs` drops the leading `verify` and passes the rest to the earlier command line.
