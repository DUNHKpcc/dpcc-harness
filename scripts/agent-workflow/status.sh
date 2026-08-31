#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${HARNSS_WORKFLOW_STATE_DIR:-$ROOT/.harnss/agent-workflow}"
STATUS_REPORT="$STATE_DIR/latest-status.md"
EVIDENCE="$ROOT/scripts/agent-workflow/evidence.mjs"
mkdir -p "$STATE_DIR"
cd "$ROOT" || exit 1

tool_line() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf -- '- `%s`: `%s`\n' "$name" "$(command -v "$name")"
  else
    printf -- '- `%s`: missing\n' "$name"
  fi
}

{
  printf '# Harnss Pi-first Workflow Status\n\n'
  printf -- '- Generated: `%s`\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
  printf -- '- Repo: `%s`\n' "$ROOT"
  printf -- '- Branch: `%s`\n' "$(git branch --show-current 2>/dev/null || printf 'unknown')"
  printf -- '- Changed files: `%s`\n\n' "$(git status --short --untracked-files=all | wc -l | tr -d ' ')"

  node "$EVIDENCE" report

  printf '## Tool Availability\n\n'
  for tool in node pnpm rg semgrep serena; do tool_line "$tool"; done
  printf '\n'

  printf '## Pi Reference\n\n'
  if node scripts/agent-workflow/pi-reference.mjs check --json >"$STATE_DIR/latest-pi-reference-check.json"; then
    node - "$STATE_DIR/latest-pi-reference-check.json" <<'NODE'
const x = require(process.argv[2]);
console.log(`- Contract: pass`);
console.log(`- Pinned sources: ${x.sources.length}/3`);
console.log(`- Routes: ${x.routes}`);
console.log(`- Benchmark scenarios: ${x.scenarios}`);
NODE
  else
    printf '%s\n' "- Contract: failed"
  fi
  if [ -f "$STATE_DIR/latest-pi-benchmark.json" ]; then
    node - "$STATE_DIR/latest-pi-benchmark.json" <<'NODE'
const x = require(process.argv[2]);
console.log(`- Latest Recall@5: ${(x.recallAt5 * 100).toFixed(1)}% (${x.passed}/${x.total})`);
console.log(`- Required Recall@5: ${(x.minimumRecallAt5 * 100).toFixed(1)}%`);
NODE
  else
    printf '%s\n' "- Latest benchmark: not run"
  fi
  printf '\n'

  printf '## Serena Lifecycle\n\n'
  pid="$(cat "$STATE_DIR/serena.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    owned="$(META_FILE="$STATE_DIR/serena-process.json" PID="$pid" ROOT="$ROOT" node <<'NODE'
const fs = require("node:fs");
try {
  const meta = JSON.parse(fs.readFileSync(process.env.META_FILE, "utf8"));
  process.stdout.write(String(meta.pid === Number(process.env.PID)
    && meta.root === process.env.ROOT
    && meta.purpose === "explicit-http-debug"));
} catch {
  process.stdout.write("false");
}
NODE
)"
    if [ "$owned" = "true" ] && [[ "$command" == *serena*start-mcp-server*"$ROOT"* ]]; then
      printf -- '- Explicit HTTP debug process: verified, PID `%s`\n' "$pid"
    else
      printf -- '- Legacy/unverified HTTP process: PID `%s`; workflow will not claim ownership\n' "$pid"
    fi
  else
    printf '%s\n' "- Explicit HTTP debug process: not running"
  fi
  printf '%s\n\n' "- Codex semantic path: stdio MCP when configured; workflow:start does not duplicate it"

  printf '## Completion Contract\n\n'
  printf '%s\n' '- Run `pnpm workflow:review -- --fast` during iteration.'
  printf '%s\n' '- Run `pnpm workflow:review -- --full` before claiming local completion.'
  printf '%s\n' "- Packaging is never run by the local workflow; GitHub Actions owns package and smoke gates."
  printf '%s\n' '- A required GitHub `quality` status remains an external branch-protection setting.'
} | tee "$STATUS_REPORT"

printf '[info] Evidence report written to %s\n' "$STATUS_REPORT"
