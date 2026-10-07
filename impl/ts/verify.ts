import { readFileSync } from "node:fs";
import { Bad, auditAuthority, checkRecords, replay, validateEnvelope, verifyChain } from "./lib.ts";

const args = process.argv.slice(2);
let json = false;
let head: string | undefined;
const files: string[] = [];
let usage = args[0] !== "verify";
for (let i = 1; i < args.length && !usage; i++) {
  if (args[i] === "--json") json = true;
  else if (args[i] === "--head") {
    if (i + 1 >= args.length) usage = true;
    else head = args[++i];
  } else if (args[i].startsWith("--")) usage = true;
  else files.push(args[i]);
}
if (usage || files.length < 1 || files.length > 2) {
  console.error("usage: verify <chain-file> [<envelope-file>] [--json] [--head <hash>]");
  process.exit(2);
}
const load = (path: string): any =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
try {
  const records = load(files[0]);
  checkRecords(records, true);
  const env = files.length > 1 ? load(files[1]) : null;
  if (files.length > 1 && (typeof env !== "object" || env === null || Array.isArray(env))) throw new Bad("bad_request");
  const chain = verifyChain(records, head);
  const findings = [...chain.findings];
  if (env) findings.push(...auditAuthority(records, env).findings, ...replay(records, env).findings);
  const envelope = env ? validateEnvelope(env) : null;
  const ok = findings.every((f) => f.code === "UNCHECKED_FIELDS") && (envelope === null || envelope.valid);
  const report = { ok, records: records.length, tail: chain.tail, envelope, findings };
  console.log(json ? JSON.stringify(report) : `${ok ? "OK" : "FAIL"}: ${records.length} records, tail ${chain.tail}, ${findings.length} findings`);
  process.exitCode = ok ? 0 : 1;
} catch {
  console.error("cannot use input");
  process.exitCode = 3;
}
