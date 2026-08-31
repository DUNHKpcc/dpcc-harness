#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${HARNSS_WORKFLOW_STATE_DIR:-$ROOT/.harnss/agent-workflow}"
mkdir -p "$STATE_DIR"

if [ "${WORKFLOW_NO_TEE:-0}" != "1" ]; then
  exec 3>&1 4>&2
  exec >"$STATE_DIR/latest-doctor.log" 2>&1
  trap 'status=$?; exec 1>&3 2>&4; cat "$STATE_DIR/latest-doctor.log"; exit "$status"' EXIT
fi

if [ -d "$HOME/.local/bin" ]; then
  PATH="$HOME/.local/bin:$PATH"
fi
if [ -d "$HOME/Library/pnpm/.tools/pnpm/10.26.0/bin" ]; then
  PATH="$HOME/Library/pnpm/.tools/pnpm/10.26.0/bin:$PATH"
fi
export PATH

ok() { printf '[ok] %s\n' "$1"; }
warn() { printf '[warn] %s\n' "$1"; }
info() { printf '[info] %s\n' "$1"; }

missing=0
optional_missing=0

required_tool() {
  local name="$1"
  local tool_path
  tool_path="$(command -v "$name" 2>/dev/null || true)"
  if [ -z "$tool_path" ]; then
    warn "$name: missing"
    missing=$((missing + 1))
    return
  fi
  ok "$name: $tool_path"
  case "$name" in
    node|pnpm|semgrep)
      "$name" --version 2>/dev/null | head -1 | sed "s/^/[info] $name version: /" || true
      ;;
  esac
}

optional_tool() {
  local name="$1"
  local tool_path
  tool_path="$(command -v "$name" 2>/dev/null || true)"
  if [ -z "$tool_path" ]; then
    warn "$name: optional tool missing"
    optional_missing=$((optional_missing + 1))
    return
  fi
  ok "$name: $tool_path"
  "$name" --version 2>/dev/null | head -1 | sed "s/^/[info] $name version: /" || true
}

required_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    warn "required workflow file missing: $file"
    missing=$((missing + 1))
    return
  fi
  if git check-ignore -q "$file" 2>/dev/null && ! git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
    warn "required workflow file is ignored and cannot survive a clean clone: $file"
    missing=$((missing + 1))
    return
  fi
  ok "workflow file: $file"
}

cd "$ROOT" || exit 1
printf '== Harnss Pi-first workflow doctor ==\n'
info "repo: $ROOT"
info "branch: $(git branch --show-current 2>/dev/null || printf 'unknown')"

printf '\n== Required tools ==\n'
for tool in git node pnpm bash rg semgrep; do
  required_tool "$tool"
done

printf '\n== Optional semantic tools ==\n'
for tool in uv uvx serena; do
  optional_tool "$tool"
done
if [ -f ".code-review-graph/graph.db" ]; then
  ok "code-review-graph: local graph database found"
else
  warn "code-review-graph: optional local graph database is absent; build it through the Codex MCP when needed"
  optional_missing=$((optional_missing + 1))
fi

printf '\n== Reproducible repository files ==\n'
required_files=(
  ".agents/skills/harnss-agent-workflow/SKILL.md"
  ".agents/skills/harnss-agent-workflow/agents/openai.yaml"
  ".agents/skills/harnss-agent-workflow/scripts/start.sh"
  ".serena/project.yml"
  ".semgrep.yml"
  "scripts/agent-workflow/doctor.sh"
  "scripts/agent-workflow/start.sh"
  "scripts/agent-workflow/hook.sh"
  "scripts/agent-workflow/handoff.sh"
  "scripts/agent-workflow/record.sh"
  "scripts/agent-workflow/review.sh"
  "scripts/agent-workflow/status.sh"
  "scripts/agent-workflow/subagent.sh"
  "scripts/agent-workflow/stop.sh"
  "scripts/agent-workflow/evidence.mjs"
  "scripts/agent-workflow/pi-reference.mjs"
  "scripts/agent-workflow/pi-reference.json"
  "scripts/agent-workflow/pi-reference-benchmark.json"
  "scripts/agent-workflow/workflow.test.mjs"
)
for file in "${required_files[@]}"; do
  required_file "$file"
done

if [ -e "AGENTS.md" ] && [ -f "CLAUDE.md" ]; then
  ok "project instructions: AGENTS.md and CLAUDE.md are present"
else
  warn "project instructions: AGENTS.md or CLAUDE.md is missing"
  missing=$((missing + 1))
fi

printf '\n== Script syntax and command wiring ==\n'
syntax_failed=0
for script in scripts/agent-workflow/*.sh; do
  if ! bash -n "$script"; then
    warn "bash syntax failed: $script"
    syntax_failed=$((syntax_failed + 1))
  fi
done
if [ "$syntax_failed" -eq 0 ]; then
  ok "bash syntax: all workflow scripts"
else
  missing=$((missing + syntax_failed))
fi
node_syntax_failed=0
for script in scripts/agent-workflow/*.mjs; do
  if ! node --check "$script"; then
    warn "node syntax failed: $script"
    node_syntax_failed=$((node_syntax_failed + 1))
  fi
done
if [ "$node_syntax_failed" -eq 0 ]; then
  ok "node syntax: all workflow modules"
else
  missing=$((missing + node_syntax_failed))
fi

command_check="$({
  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const entries = Object.entries(pkg.scripts).filter(([name]) => name.startsWith("workflow:"));
const missing = [];
for (const [name, command] of entries) {
  const matches = command.match(/scripts\/agent-workflow\/[A-Za-z0-9._/-]+/g) || [];
  if (matches.length === 0) missing.push(`${name}: no repository workflow target`);
  for (const target of matches) {
    if (!fs.existsSync(path.resolve(target))) missing.push(`${name}: missing ${target}`);
  }
}
console.log(JSON.stringify({ count: entries.length, missing }));
NODE
} 2>/dev/null)"
if [ -z "$command_check" ]; then
  warn "package workflow command check did not produce a result"
  missing=$((missing + 1))
else
  command_count="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(String(x.count))' "$command_check")"
  command_missing="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(String(x.missing.length))' "$command_check")"
  if [ "$command_missing" -eq 0 ] && [ "$command_count" -gt 0 ]; then
    ok "package workflow commands: $command_count target(s) resolve"
  else
    warn "package workflow commands: $command_missing broken target(s)"
    node -e 'const x=JSON.parse(process.argv[1]); for (const line of x.missing) console.log(`[warn] ${line}`)' "$command_check"
    missing=$((missing + command_missing + 1))
  fi
fi

printf '\n== Pi reference contract ==\n'
if node scripts/agent-workflow/pi-reference.mjs check --json >"$STATE_DIR/latest-pi-reference-check.json"; then
  source_count="$(node -e 'const x=require(process.argv[1]); process.stdout.write(String(x.sources.length))' "$STATE_DIR/latest-pi-reference-check.json")"
  route_count="$(node -e 'const x=require(process.argv[1]); process.stdout.write(String(x.routes))' "$STATE_DIR/latest-pi-reference-check.json")"
  scenario_count="$(node -e 'const x=require(process.argv[1]); process.stdout.write(String(x.scenarios))' "$STATE_DIR/latest-pi-reference-check.json")"
  ok "Pi reference: $source_count pinned sources, $route_count routes, $scenario_count benchmark scenarios"
else
  warn "Pi reference contract failed; see $STATE_DIR/latest-pi-reference-check.json"
  missing=$((missing + 1))
fi

printf '\n== Host integration ==\n'
if rg -q '^\[mcp_servers\.serena\]' .codex/config.toml "$HOME/.codex/config.toml" 2>/dev/null; then
  ok "Codex Serena MCP: configured"
else
  warn "Codex Serena MCP: optional host config is absent; rg and Pi reference queries remain available"
  optional_missing=$((optional_missing + 1))
fi

printf '\n== Install hints ==\n'
if ! command -v semgrep >/dev/null 2>&1; then
  printf 'Semgrep: uv tool install semgrep\n'
fi
if ! command -v serena >/dev/null 2>&1; then
  printf 'Serena:  uv tool install -p 3.13 serena-agent\n'
fi

printf '\n== Status ==\n'
if [ "$missing" -gt 0 ]; then
  warn "$missing required item(s) failed; workflow is not ready"
  exit 1
fi
ok "workflow is ready; $optional_missing optional item(s) unavailable"
