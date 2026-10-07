import { readFileSync } from 'node:fs';
import { auditAuthority, checkRecords, isObj, OpError, replay, validateEnvelope, verifyChain } from './lib.ts';

const args = process.argv.slice(2);
const files: string[] = [];
let json = false;
let head: string | undefined;
let usage = args[0] !== 'verify';
for (let i = 1; i < args.length && !usage; i++) {
  const a = args[i];
  if (a === '--json') json = true;
  else if (a === '--head') { if (i + 1 < args.length) head = args[++i]; else usage = true; }
  else if (a.startsWith('--')) usage = true;
  else files.push(a);
}
if (usage || files.length < 1 || files.length > 2) {
  console.error('usage: verify <chain-file> [<envelope-file>] [--json] [--head <hash>]');
  process.exit(2);
}

const load = (path: string) => JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path)));
try {
  const chain = load(files[0]);
  if (!Array.isArray(chain)) throw new OpError('bad_request');
  checkRecords(chain, true);
  const env = files.length === 2 ? load(files[1]) : null;
  if (files.length === 2 && !isObj(env)) throw new OpError('bad_request');
  const vc = verifyChain(chain, head);
  const envelope = env ? validateEnvelope(env) : null;
  const findings = env
    ? [...vc.findings, ...auditAuthority(chain, env).findings, ...replay(chain, env).findings]
    : vc.findings;
  const ok = findings.every((f) => f.code === 'UNCHECKED_FIELDS') && (envelope === null || envelope.valid);
  if (json) {
    process.stdout.write(JSON.stringify({ ok, records: chain.length, tail: vc.tail, envelope, findings }) + '\n');
  } else {
    const lines = [`${ok ? 'OK' : 'FAIL'}: ${chain.length} records, tail ${vc.tail}`];
    for (const e of envelope?.errors ?? []) lines.push(`envelope ${e.code} at ${e.path || '(root)'}`);
    for (const f of findings) lines.push(`seq ${f.seq} ${f.code}${f.field !== undefined ? ' ' + f.field : ''}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('cannot use input: ' + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 3;
}
