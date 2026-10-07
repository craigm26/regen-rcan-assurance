// Tertiary subject: the earlier TypeScript SDK's canonical JSON writer, run on the canonical
// cases only (every other operation is n/a for it). Speaks the suite's line protocol; request-
// level errors are answered here, as in the main reference adapter. The writer is loaded from
// the path in local.json and called unchanged; its bytes are returned as base64.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const local = JSON.parse(readFileSync(new URL('./local.json', import.meta.url), 'utf8'));
const enc = await import(pathToFileURL(local.encoding).href);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const OPS = ['canonical', 'envelopeHash', 'recordHash', 'validateEnvelope', 'verifyChain', 'auditAuthority', 'replay'];
function answer(line) {
  let req;
  try { req = JSON.parse(line); } catch { return { id: null, error: 'bad_request' }; }
  if (!isObj(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const { id, op, input } = req;
  if (typeof op !== 'string' || !OPS.includes(op)) return { id, error: 'unknown_op' };
  if (!isObj(input)) return { id, error: 'bad_request' };
  if (op !== 'canonical') return { id, error: 'not_in_this_subject' };
  if (!Object.hasOwn(input, 'value')) return { id, error: 'bad_request' };
  try { return { id, result: Buffer.from(enc.canonicalJson(input.value)).toString('base64') }; } catch (e) {
    process.stderr.write(`${id}: ${e?.stack ?? e}\n`);
    return { id, error: 'reference_threw' };
  }
}
const handle = (line) => { if (!/^[ \t\r]*$/.test(line)) process.stdout.write(JSON.stringify(answer(line)) + '\n'); };
let buf = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  buf += chunk;
  for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
}
if (buf !== '') handle(buf);
