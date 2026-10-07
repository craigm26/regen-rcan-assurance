#!/usr/bin/env bash
# usage: launch-blind.sh <sandbox-dir> <model> <lang>
# <sandbox-dir> holds w/ (SPEC.md, DECISIONS.md, PROMPT.md) and meta/.
set -uo pipefail
SB="$1"; MODEL="$2"; LANG_ID="$3"
WORK="$SB/w"; META="$SB/meta"; mkdir -p "$META"
# Per-language Bash rules, one per line, copied from the brief at tool-writing time:
mapfile -t LANG_RULES < "$(dirname "$0")/allowed-$LANG_ID.txt"
ALLOWED=( "Read" "Write" "Edit" "Glob" "Grep"
          "Bash(mkdir *)" "Bash(ls *)" "Bash(git init*)" "Bash(git add *)" "Bash(git commit *)"
          "${LANG_RULES[@]}" )
cd "$WORK" || exit 2
echo $$ > "$META/launcher.pid"
# The builder starts from an empty environment plus an allow-list: what the CLI needs to reach
# the model (proxy, CA bundle, API base URL) and, on Windows, to find its own login. Nothing of
# the orchestrator's session, tokens or cloud credentials is passed on.
KEEP=(PATH HOME USER LANG LC_ALL TERM TZ TMPDIR
      HTTPS_PROXY https_proxy HTTP_PROXY http_proxy NO_PROXY no_proxy
      NODE_EXTRA_CA_CERTS SSL_CERT_FILE ANTHROPIC_BASE_URL CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
      SYSTEMROOT SystemRoot USERPROFILE APPDATA LOCALAPPDATA COMSPEC PATHEXT TEMP TMP)
ENVV=()
for k in "${KEEP[@]}"; do [ -n "${!k+x}" ] && ENVV+=("$k=${!k}"); done
# Package managers fail closed even if something tries to fetch.
ENVV+=(GOPROXY=off GOTOOLCHAIN=local npm_config_offline=true PIP_NO_INDEX=1)
printf '%s\n' "${ENVV[@]%%=*}" > "$META/env-names.txt"
rc=0
env -i "${ENVV[@]}" claude -p "$(cat PROMPT.md)" \
  --model "$MODEL" \
  --restricted --safe-mode \
  --tools "Read,Write,Edit,Glob,Grep,Bash" \
  --disallowedTools "WebFetch" "WebSearch" "mcp__*" \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --permission-mode dontAsk --permission-prompts none \
  --allowedTools "${ALLOWED[@]}" \
  --max-turns 400 --no-session-persistence \
  --output-format stream-json --verbose \
  < /dev/null > "$META/transcript.jsonl" 2> "$META/stderr.log" || rc=$?
echo "exit=$rc" >> "$META/stderr.log"
