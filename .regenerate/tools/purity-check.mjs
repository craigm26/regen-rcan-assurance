// Every impl/<lang>/ tree must equal the impl_tree of its latest promotion entry
// in .regenerate/ledger.jsonl. No impl/ at all passes.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const implDir = join(root, 'impl');
if (!existsSync(implDir)) {
  console.log('purity: no impl/ - pass');
  process.exit(0);
}
const ledgerPath = join(root, '.regenerate', 'ledger.jsonl');
const entries = existsSync(ledgerPath)
  ? readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  : [];
let failed = 0;
for (const lang of readdirSync(implDir).filter((d) => statSync(join(implDir, d)).isDirectory())) {
  const promos = entries.filter((e) => e.kind === 'promotion' && e.lang === lang);
  const latest = promos[promos.length - 1];
  let tree = '';
  try {
    tree = execFileSync('git', ['rev-parse', `HEAD:impl/${lang}`], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    tree = '(not committed)';
  }
  if (!latest) {
    console.log(`purity: impl/${lang} FAIL - no promotion entry`);
    failed++;
  } else if (latest.impl_tree !== tree) {
    console.log(`purity: impl/${lang} FAIL - tree ${tree} != promoted ${latest.impl_tree} (${latest.run})`);
    failed++;
  } else {
    console.log(`purity: impl/${lang} ok - ${latest.run} @ ${latest.spec_tag}`);
  }
}
process.exit(failed ? 1 : 0);
