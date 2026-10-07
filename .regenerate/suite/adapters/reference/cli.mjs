// Reference adapter command line. The suite calls `verify <arguments>`; the earlier
// implementation's command line takes `<chain.json> [envelope.json]` with no subcommand and no
// options. This drops a leading `verify`, passes everything else through unchanged, and exits
// with the earlier program's status. Only the exit-status cases the earlier program can answer
// are run against it (the rest are n/a for the reference).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const local = JSON.parse(readFileSync(new URL('./local.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const rest = args[0] === 'verify' ? args.slice(1) : args;
const r = spawnSync(process.execPath, ['--experimental-strip-types', local.verifier, ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
