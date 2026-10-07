#!/usr/bin/env node
// usage: leak-check.mjs <dir> [extra identifiers...]
// Fails (exit 1) if any file under <dir> contains a brief identifier, a reference repo URL
// or org, an absolute local path, or a distinctive reference symbol (unless allowlisted).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dir, ...extra] = process.argv.slice(2);
if (!dir) { console.error('usage: leak-check.mjs <dir> [identifiers...]'); process.exit(2); }
const terms = JSON.parse(readFileSync(join(import.meta.dirname, 'leak-terms.json'), 'utf8'));
const identifiers = [...terms.identifiers, ...extra];
const allow = new Set(terms.allow);
const PATHS = [/[A-Za-z]:[\\/]Users[\\/]/i, /(^|[\s"'`(])\/c\/Users\//i, /(^|[\s"'`(])\/home\/[a-z]/i, /(^|[\s"'`(])\/Users\/[A-Za-z]/];
const hits = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const text = readFileSync(p, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = `${relative(dir, p)}:${i + 1}`;
      for (const id of identifiers) if (line.toLowerCase().includes(id.toLowerCase())) hits.push(`${at} identifier "${id}"`);
      for (const s of terms.symbols) if (!allow.has(s) && line.includes(s)) hits.push(`${at} symbol "${s}"`);
      for (const re of PATHS) if (re.test(line)) hits.push(`${at} absolute path ${re}`);
    });
  }
};
walk(dir);
if (hits.length) { console.log(`leak-check FAIL (${hits.length})\n  ` + hits.join('\n  ')); process.exit(1); }
console.log(`leak-check ok: ${dir}`);
