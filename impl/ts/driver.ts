import { Bad, OPS, run } from "./lib.ts";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Buffer.concat(chunks));
const out: string[] = [];
for (const line of text.split("\n")) {
  if (/^[ \t\r]*$/.test(line)) continue;
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    req = undefined;
  }
  let res: any;
  if (typeof req !== "object" || req === null || Array.isArray(req) || typeof req.id !== "string") {
    res = { id: null, error: "bad_request" };
  } else if (typeof req.op !== "string" || !OPS.includes(req.op)) {
    res = { id: req.id, error: "unknown_op" };
  } else {
    try {
      res = { id: req.id, result: run(req.op, req.input) };
    } catch (e) {
      res = { id: req.id, error: e instanceof Bad ? e.code : "bad_request" };
    }
  }
  out.push(JSON.stringify(res));
}
process.stdout.write(out.map((l) => l + "\n").join(""));
