// Reference adapter driver. Speaks the suite's line protocol (SPEC § 1.2 and § 1.3) and answers
// with the earlier implementation, loaded from the paths in local.json.
//
// Request-level errors (REQ-IF-007 steps 1 to 3, except the § 5.1 record-shape check) are
// answered here, because the earlier implementation has no request protocol. Nothing else is
// repaired: what the earlier code returns is what the suite sees, and when it throws, the
// response is the non-spec error "reference_threw".
//
// Two translations of output format, not behavior:
// - validateEnvelope runs the earlier tooling's JSON Schema engine (Ajv, draft 2020-12, the
//   options its own test uses). Its errors use the engine's keyword names; in --reference mode
//   the suite compares only `valid`.
// - The earlier replay names an unchecked field only inside its detail text
//   ("applied.<name> is not judged ..."); the adapter copies that name into `field`.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const local = JSON.parse(readFileSync(new URL('./local.json', import.meta.url), 'utf8'));
const lib = await import(pathToFileURL(local.verifier).href);
const Ajv2020 = (await import(pathToFileURL(local.ajv2020).href)).default;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(local.schema, 'utf8')));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const any = () => true;
const isString = (v) => typeof v === 'string';
// [member, type test, optional]
const NEEDS = {
  canonical: [['value', any]],
  envelopeHash: [['envelope', isObj]],
  recordHash: [['record', isObj]],
  validateEnvelope: [['envelope', any]],
  verifyChain: [['records', Array.isArray], ['expectedHead', isString, true]],
  auditAuthority: [['records', Array.isArray], ['envelope', isObj]],
  replay: [['records', Array.isArray], ['envelope', isObj]],
};
const UNCHECKED = /^applied\.(.*) is not judged by this reference replay$/s;
const withField = (f) => {
  const m = f && f.code === 'UNCHECKED_FIELDS' && typeof f.detail === 'string' ? UNCHECKED.exec(f.detail) : null;
  return m ? { ...f, field: m[1] } : f;
};
const RUN = {
  canonical: (i) => Buffer.from(lib.canonicalJson(i.value), 'utf8').toString('base64'),
  envelopeHash: (i) => lib.envelopeHash(i.envelope),
  recordHash: (i) => lib.recordHash(i.record),
  validateEnvelope: (i) => {
    const valid = validate(i.envelope);
    return { valid, errors: (validate.errors ?? []).map((e) => ({ path: e.instancePath, code: e.keyword })) };
  },
  verifyChain: (i) => ({ findings: lib.verifyChain(i.records, i.expectedHead) }),
  auditAuthority: (i) => ({ findings: lib.auditAuthority(i.records, i.envelope) }),
  replay: (i) => ({ findings: lib.replayAgainstEnvelope(i.records, i.envelope).map(withField) }),
};

function answer(line) {
  let req;
  try { req = JSON.parse(line); } catch { return { id: null, error: 'bad_request' }; }
  if (!isObj(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const { id, op, input } = req;
  if (typeof op !== 'string' || !Object.hasOwn(NEEDS, op)) return { id, error: 'unknown_op' };
  if (!isObj(input)) return { id, error: 'bad_request' };
  for (const [k, test, optional] of NEEDS[op]) {
    if (!Object.hasOwn(input, k)) { if (optional) continue; return { id, error: 'bad_request' }; }
    if (!test(input[k])) return { id, error: 'bad_request' };
  }
  try { return { id, result: RUN[op](input) }; } catch (e) {
    process.stderr.write(`${id}: ${e?.stack ?? e}\n`);
    return { id, error: 'reference_threw' };
  }
}

// Lines split at LF only (REQ-IF-002); CR stays in the line as JSON whitespace.
const handle = (line) => { if (!/^[ \t\r]*$/.test(line)) process.stdout.write(JSON.stringify(answer(line)) + '\n'); };
let buf = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  buf += chunk;
  for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
}
if (buf !== '') handle(buf);
