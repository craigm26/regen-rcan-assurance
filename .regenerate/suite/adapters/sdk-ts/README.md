# Tertiary subject: the TypeScript SDK's canonical JSON writer

The earlier TypeScript SDK has its own canonical JSON writer, whose comment says it matches the
Python SDK's. This adapter runs the suite's canonical cases against it (ledger `r00-sdk-ts`).
It contains no SDK code; `local.json` (gitignored) names the pristine clone's source file:
`{ "encoding": "<clone root>/src/encoding.ts" }`, loaded by type stripping.

Run: `node .regenerate/suite/run.mjs --impl .regenerate/suite/adapters/sdk-ts --reference --na envelopeHash,recordHash,validateEnvelope,verifyChain,auditAuthority,replay,cli,if-regen`
