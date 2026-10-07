import { readFileSync } from "node:fs";
import { verifyChain, validateEnvelope, auditAuthority, replay, recordsOk, isObj, OpError } from "./lib.ts";

class Bad extends Error {}

function load(path: string): any {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    return JSON.parse(text);
  } catch {
    throw new Bad();
  }
}

export function main(argv: string[]): number {
  if (argv[0] !== "verify") return 2;
  let json = false, head: string | undefined;
  const files: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--head") {
      if (i + 1 >= argv.length) return 2;
      head = argv[++i];
    } else if (a.startsWith("--")) return 2;
    else files.push(a);
  }
  if (files.length < 1 || files.length > 2) return 2;
  try {
    const records = load(files[0]);
    if (!recordsOk(records, true)) throw new Bad();
    const env = files.length === 2 ? load(files[1]) : null;
    if (files.length === 2 && !isObj(env)) throw new Bad();
    const chain = verifyChain(records, head);
    const findings: any[] = [...chain.findings];
    let envelope: any = null;
    if (files.length === 2) {
      envelope = validateEnvelope(env);
      findings.push(...auditAuthority(records, env).findings, ...replay(records, env).findings);
    }
    const ok = findings.every((f) => f.code === "UNCHECKED_FIELDS") && (envelope === null || envelope.valid);
    if (json) {
      process.stdout.write(JSON.stringify({ ok, records: records.length, tail: chain.tail, envelope, findings }) + "\n");
    } else {
      const lines = findings.map((f) => `${f.seq ?? "-"} ${f.code}${f.field !== undefined ? " " + f.field : ""}`);
      if (envelope && !envelope.valid) lines.push(...envelope.errors.map((e: any) => `envelope ${e.path || "/"} ${e.code}`));
      lines.push(`${ok ? "OK" : "FAIL"}: ${records.length} records, tail ${chain.tail}`);
      process.stdout.write(lines.join("\n") + "\n");
    }
    return ok ? 0 : 1;
  } catch (e) {
    if (e instanceof Bad || e instanceof OpError) return 3;
    throw e;
  }
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
