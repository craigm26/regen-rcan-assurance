import { isObj, OPS, OpError, run } from './lib.ts';

function respond(line: string) {
  let req;
  try { req = JSON.parse(line); } catch { req = null; }
  if (!isObj(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const { id, op, input } = req;
  if (typeof op !== 'string' || !Object.hasOwn(OPS, op)) return { id, error: 'unknown_op' };
  try {
    return { id, result: run(op, input) };
  } catch (e) {
    return { id, error: e instanceof OpError ? e.cat : 'bad_request' };
  }
}

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c);
const out: string[] = [];
for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
  if (/^[ \t\r]*$/.test(line)) continue;
  out.push(JSON.stringify(respond(line)) + '\n');
}
process.stdout.write(out.join(''));
