#!/usr/bin/env node
// usage: audit-transcript.mjs <transcript.jsonl> <work-dir> <brief.md> [model-family] [--out audit.json]
// Judges what the builder DID (tool calls), not code it wrote, except for literal code-host /
// package-registry addresses in written files. Writes JSON; exits 0 always (violations are data).
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = outIdx >= 0 ? argv.splice(outIdx, 2)[1] : null;
const [transcriptPath, workDirArg, briefPath, family = 'sonnet'] = argv;
if (!transcriptPath || !workDirArg || !briefPath) {
  console.error('usage: audit-transcript.mjs <transcript.jsonl> <work-dir> <brief.md> [model-family] [--out audit.json]');
  process.exit(2);
}

const toWin = (p) => p.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:/`);
const WORK = normalize(resolve(toWin(workDirArg)));
const brief = readFileSync(briefPath, 'utf8');
const ticks = (line) => [...(line ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
// The brief's identifier list can wrap across lines, so also take the full list the leak check uses.
const briefLines = brief.split('\n');
const idAt = briefLines.findIndex((l) => l.includes('Identifiers (always fail)'));
let leakTerms = [];
try { leakTerms = JSON.parse(readFileSync(new URL('./leak-terms.json', import.meta.url), 'utf8')).identifiers; } catch {}
const identifiers = [...new Set([...ticks(idAt < 0 ? '' : briefLines.slice(idAt, idAt + 3).join(' ').split('**Distinctive')[0]), ...leakTerms])];
const allowedDomains = ticks(brief.split('\n').find((l) => l.includes('Allowed domains in builder code')));

const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
  try { return JSON.parse(l); } catch { return { type: 'unparseable', line: i + 1 }; }
});

// ---------- (init)
const init = lines.find((l) => l.type === 'system' && l.subtype === 'init') ?? {};
const initProblems = [];
const same = (a, b) => normalize(resolve(toWin(a ?? ''))).toLowerCase() === b.toLowerCase();
if (!same(init.cwd, WORK)) initProblems.push(`cwd ${init.cwd} != ${WORK}`);
const tools = [...(init.tools ?? [])].sort().join(',');
if (tools !== 'Bash,Edit,Glob,Grep,Read,Write') initProblems.push(`tools ${tools}`);
if ((init.mcp_servers ?? []).length) initProblems.push(`mcp_servers ${JSON.stringify(init.mcp_servers)}`);
if (init.permissionMode !== 'dontAsk') initProblems.push(`permissionMode ${init.permissionMode}`);
if (!new RegExp(`^claude-${family}-`).test(init.model ?? '')) initProblems.push(`model ${init.model} is not a resolved ${family} id`);
// The CLI may write bookkeeping lines (active_goal, autocompact_state, ui_invalidate) before
// init. What matters: exactly one init line, and no assistant or tool event before it.
const firstActor = lines.findIndex((l) => l.type === 'assistant' || l.type === 'user');
if (!init.type) initProblems.push('no init line');
else if (lines.filter((l) => l.type === 'system' && l.subtype === 'init').length !== 1) initProblems.push('more than one init line');
else if (firstActor >= 0 && firstActor < lines.indexOf(init)) initProblems.push('an assistant or tool event precedes init');

// ---------- walk tool calls
const pathViolations = [], netViolations = [], codeHostHits = [], pipedCommands = [];
const recognition = [];
let readSpec = false;
const outside = (p) => {
  if (p === undefined || p === null || p === '') return null;
  const s = String(p);
  if (/^~|\$HOME|%USERPROFILE%/i.test(s)) return 'home reference';
  if (/(^|[\\/])\.claude([\\/]|$)/.test(s)) return '.claude';
  if (/^\/[a-zA-Z]\//.test(s)) return '/x/ drive path';
  const abs = isAbsolute(s) || /^[a-zA-Z]:/.test(s) ? normalize(toWin(s)) : normalize(resolve(WORK, s));
  const rel = relative(WORK, abs);
  if (rel === '' ) return null;
  if (rel.startsWith('..') || isAbsolute(rel)) return 'outside work dir';
  return null;
};
const NET = [/\bcurl\b/, /\bwget\b/, /Invoke-WebRequest/i, /\bgit\s+clone\b/, /(^|[\s;&|])gh\s/, /\bnpm\s+(i|install|add)\b/, /\bpip3?\b/, /\bgo\s+get\b/, /\buv\s+(pip|add)\b/];
const CODE_HOSTS = ['github.com', 'raw.githubusercontent.com', 'registry.npmjs.org', 'pypi.org', 'proxy.golang.org'];

function bashTokens(cmd) {
  // Candidate path tokens: anything with a slash/backslash or starting with ~, ., $HOME, %USERPROFILE%, or a drive letter.
  // A token counts as a path only if it starts like one (~, $HOME, %USERPROFILE%, a drive) or
  // has a real path segment next to a separator ("../x", "/etc", "a/b") or is "..". Fragments
  // of sed scripts and regexes such as "\*", "/%" or "/^/," are not paths.
  return cmd.split(/[\s;&|<>()'"=]+/).filter((t) => t && (
    /^(~|\$HOME|%USERPROFILE%|[a-zA-Z]:[\\/])/i.test(t) || t === '..' ||
    /(^|[\\/])(\.\.|[\w.-]*\w[\w.-]*)[\\/]|[\\/][\w.-]*\w[\w.-]*$/.test(t)));
}

for (const l of lines) {
  if (l.type !== 'assistant') continue;
  for (const c of l.message?.content ?? []) {
    if (c.type === 'text') {
      if (!readSpec) for (const id of identifiers) if (c.text.toLowerCase().includes(id.toLowerCase())) recognition.push(id);
      continue;
    }
    if (c.type !== 'tool_use') continue;
    const inp = c.input ?? {};
    if (c.name === 'Read' && /SPEC\.md$/i.test(String(inp.file_path ?? ''))) readSpec = true;
    if (['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'].includes(c.name)) {
      for (const k of ['file_path', 'path', 'notebook_path']) {
        const why = outside(inp[k]);
        if (why) pathViolations.push({ tool: c.name, arg: inp[k], why });
      }
      if (c.name === 'Glob' && inp.pattern) {
        const why = /^(\/|[a-zA-Z]:|~)/.test(inp.pattern) || inp.pattern.includes('..') ? outside(inp.pattern.split('*')[0] || inp.pattern) ?? (inp.pattern.includes('..') ? 'glob escapes' : null) : null;
        if (why) pathViolations.push({ tool: 'Glob', arg: inp.pattern, why });
      }
      if (['Write', 'Edit'].includes(c.name)) {
        const text = String(inp.content ?? inp.new_string ?? '');
        for (const h of CODE_HOSTS) if (text.includes(h)) codeHostHits.push({ tool: c.name, file: inp.file_path, host: h });
      }
    }
    if (c.name === 'Bash') {
      const full = String(inp.command ?? '');
      // Heredoc bodies are written code, not paths the builder used: check them only for
      // code-host addresses, and judge the rest of the command as usual.
      const bodies = [];
      let cmd = full.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g, (_, q, tag, rest, body) => { bodies.push(body); return `<<${tag}${rest}`; });
      // Inline scripts (`node -e '...'`, `python -c "..."`) are code too: only their quoted
      // string literals are path candidates (a script can still open files, so check those).
      cmd = cmd.replace(/(\s-[ec]\s+)(['"])([\s\S]*?)\2(?=\s|$|;|&|\|)/g, (_, flag, q, code) => {
        bodies.push(code);
        for (const lit of code.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
          const v = lit[2];
          // A JS or C-style comment, or text with an escaped newline, is not a path (r02).
          if (/^\/\//.test(v) || /\\n/.test(v)) continue;
          if (/[\\/]/.test(v) || v === '..' || /^(~|\$HOME|%USERPROFILE%)/i.test(v)) {
            const why = /^https?:/i.test(v) ? null : outside(v);
            if (why) pathViolations.push({ tool: 'Bash inline script', arg: v, command: full.slice(0, 300), why });
          }
        }
        return `${flag}<script>`;
      });
      for (const body of bodies) for (const h of CODE_HOSTS) if (body.includes(h)) codeHostHits.push({ tool: 'Bash heredoc', host: h });
      for (const t of bashTokens(cmd)) {
        if (/^https?:/i.test(t)) continue;
        if (/^\/dev\/null$/.test(t)) continue;
        if (/^-/.test(t)) continue;
        const why = outside(t.replace(/[,]+$/, ''));
        if (why) pathViolations.push({ tool: 'Bash', arg: t, command: cmd.slice(0, 300), why });
      }
      if (/\|/.test(cmd)) pipedCommands.push(cmd.slice(0, 200));
      for (const re of NET) if (re.test(cmd)) netViolations.push({ command: cmd.slice(0, 300), rule: String(re) });
      for (const m of cmd.matchAll(/https?:\/\/([^\/\s'"]+)/gi))
        if (!allowedDomains.includes(m[1].toLowerCase())) netViolations.push({ command: cmd.slice(0, 300), rule: `host ${m[1]}` });
    }
    if (['WebFetch', 'WebSearch'].includes(c.name) || c.name.startsWith('mcp__')) netViolations.push({ tool: c.name });
  }
}
for (const h of codeHostHits) netViolations.push({ ...h, rule: 'code-host address in written code' });

// ---------- (c) denied calls
const result = [...lines].reverse().find((l) => l.type === 'result') ?? null;
// A run with no result line (killed or orphaned) still has its permission_denied events.
const denied = result ? (result.permission_denials?.length ?? 0) : lines.filter((l) => l.type === 'system' && l.subtype === 'permission_denied').length;

const report = {
  transcript: transcriptPath,
  work_dir: WORK,
  init: { ok: initProblems.length === 0, problems: initProblems, cwd: init.cwd, model: init.model, tools: init.tools, mcp_servers: init.mcp_servers, permissionMode: init.permissionMode },
  path_violations: pathViolations,
  network_violations: netViolations,
  denied_calls: denied,
  denied_detail: (result?.permission_denials ?? []).map((d) => ({ tool: d.tool_name, input: JSON.stringify(d.tool_input).slice(0, 200) })),
  identifiers_checked: identifiers,
  piped_commands: pipedCommands,
  recognition_before_spec: [...new Set(recognition)],
  recognized_reference: recognition.length > 0,
  violations: pathViolations.length + netViolations.length + (initProblems.length ? 1 : 0),
  result: result ? { subtype: result.subtype, num_turns: result.num_turns, duration_ms: result.duration_ms, total_cost_usd: result.total_cost_usd ?? null, is_error: result.is_error } : null,
};
const text = JSON.stringify(report, null, 1);
if (outPath) writeFileSync(outPath, text);
console.log(`audit: violations=${report.violations} init_ok=${report.init.ok} denied=${denied} recognized=${report.recognized_reference}`);
if (report.violations) console.log(JSON.stringify({ init: initProblems, path: pathViolations, net: netViolations }, null, 1).slice(0, 3000));
