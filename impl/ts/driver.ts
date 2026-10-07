import { canonicalB64, envelopeHash, recordHash, validateEnvelope, verifyChain, auditAuthority, replay, recordsOk, isObj, OpError } from "./lib.ts";

const has = (o: any, k: string): boolean => Object.hasOwn(o, k);
const OPS = ["canonical", "envelopeHash", "recordHash", "validateEnvelope", "verifyChain", "auditAuthority", "replay"];

function run(op: string, input: any): any {
  const need = (k: string, ok: (v: any) => boolean) => {
    if (!has(input, k) || !ok(input[k])) throw new OpError("bad_request");
  };
  switch (op) {
    case "canonical": need("value", () => true); return canonicalB64(input.value);
    case "envelopeHash": need("envelope", isObj); return envelopeHash(input.envelope);
    case "recordHash": need("record", isObj); return recordHash(input.record);
    case "validateEnvelope": need("envelope", () => true); return validateEnvelope(input.envelope);
    case "verifyChain":
      need("records", (v) => recordsOk(v, true));
      if (has(input, "expectedHead")) need("expectedHead", (v) => typeof v === "string");
      return verifyChain(input.records, input.expectedHead);
    default:
      need("records", (v) => recordsOk(v, false));
      need("envelope", isObj);
      return op === "replay" ? replay(input.records, input.envelope) : auditAuthority(input.records, input.envelope);
  }
}

export function handle(line: string): string {
  let req: any;
  try { req = JSON.parse(line); } catch { req = undefined; }
  if (!isObj(req) || !has(req, "id") || typeof req.id !== "string") return JSON.stringify({ id: null, error: "bad_request" });
  const id = req.id;
  if (!has(req, "op") || typeof req.op !== "string" || !OPS.includes(req.op)) return JSON.stringify({ id, error: "unknown_op" });
  try {
    if (!has(req, "input") || !isObj(req.input)) throw new OpError("bad_request");
    return JSON.stringify({ id, result: run(req.op, req.input) });
  } catch (e) {
    if (e instanceof OpError) return JSON.stringify({ id, error: e.category });
    throw e;
  }
}

if (import.meta.main) {
  const chunks: Buffer[] = [];
  process.stdin.on("data", (c: Buffer) => chunks.push(c));
  process.stdin.on("end", () => {
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Buffer.concat(chunks));
    let out = "";
    for (const line of text.split("\n")) {
      if (/^[ \t\r]*$/.test(line)) continue;
      out += handle(line) + "\n";
    }
    process.stdout.write(out);
  });
}
