#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${HARNSS_WORKFLOW_STATE_DIR:-$ROOT/.harnss/agent-workflow}"
HANDOFF_DIR="$STATE_DIR/handoffs"
LATEST_HANDOFF="$STATE_DIR/latest-handoff.md"
LATEST_HANDOFF_LOG="$STATE_DIR/latest-handoff.log"
SERENA_PID_FILE="$STATE_DIR/serena.pid"
SERENA_PORT="${SERENA_PORT:-9121}"
EVIDENCE="$ROOT/scripts/agent-workflow/evidence.mjs"

mkdir -p "$STATE_DIR"

if [ "${WORKFLOW_NO_TEE:-0}" != "1" ]; then
  exec 3>&1 4>&2
  exec >"$LATEST_HANDOFF_LOG" 2>&1
  trap 'status=$?; exec 1>&3 2>&4; cat "$LATEST_HANDOFF_LOG"; exit "$status"' EXIT
fi

if [ -d "$HOME/.local/bin" ]; then
  PATH="$HOME/.local/bin:$PATH"
  export PATH
fi

if [ -d "$HOME/Library/pnpm/.tools/pnpm/10.26.0/bin" ]; then
  PATH="$HOME/Library/pnpm/.tools/pnpm/10.26.0/bin:$PATH"
  export PATH
fi

usage() {
  cat <<'EOF'
Usage:
  pnpm workflow:handoff -- --to <recipient> --summary <summary> --next <next-step>

Creates a Markdown handoff for switching Codex sessions or handing a task to
another Codex-owned worker. The latest handoff is written to:
  .harnss/agent-workflow/latest-handoff.md
EOF
}

TO="next Codex session"
SUMMARY=""
NEXT_STEP=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      ;;
    --to)
      shift
      TO="${1:-}"
      shift || true
      ;;
    --summary)
      shift
      SUMMARY="${1:-}"
      shift || true
      ;;
    --next)
      shift
      NEXT_STEP="${1:-}"
      shift || true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      if [ -z "$SUMMARY" ]; then
        SUMMARY="$1"
      else
        SUMMARY="$SUMMARY $1"
      fi
      shift
      ;;
  esac
done

mkdir -p "$STATE_DIR" "$HANDOFF_DIR"
cd "$ROOT" || exit 1

serena_process_status() {
  local pid="$1"
  case "$pid" in ''|*[!0-9]*) printf 'not running'; return ;; esac
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    printf 'not running'
    return
  fi
  local command owned
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
    printf 'workflow-owned, PID %s, http://127.0.0.1:%s/mcp' "$pid" "$SERENA_PORT"
  else
    printf 'legacy/unverified, PID %s; workflow will not claim ownership' "$pid"
  fi
}

timestamp="$(date '+%Y-%m-%d %H:%M:%S %Z')"
stamp="$(date '+%Y%m%d-%H%M%S')"
archive_file="$HANDOFF_DIR/$stamp-handoff.md"
if [ -e "$archive_file" ]; then
  suffix=2
  while [ -e "$HANDOFF_DIR/$stamp-$suffix-handoff.md" ]; do
    suffix=$((suffix + 1))
  done
  archive_file="$HANDOFF_DIR/$stamp-$suffix-handoff.md"
fi
branch="$(git branch --show-current 2>/dev/null || printf 'unknown')"
changed_count="$(git status --short --untracked-files=all 2>/dev/null | wc -l | tr -d ' ')"
pid="$(cat "$SERENA_PID_FILE" 2>/dev/null || true)"
run_json="$(node "$EVIDENCE" report --json)"
run_id="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.metadata.runId)' "$run_json")"
head_sha="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.current.headSha)' "$run_json")"
dirty_hash="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x.current.dirtyHash)' "$run_json")"
run_dir="$STATE_DIR/runs/$run_id"
serena_status="$(serena_process_status "$pid")"

{
  printf '# Harnss Workflow Handoff\n\n'
  printf '%s\n' "- Generated: \`$timestamp\`"
  printf '%s\n' "- Recipient: \`$TO\`"
  printf '%s\n' "- Mode: \`codex-led\`"
  printf '%s\n' "- Edit owner: \`Codex current session\`"
  printf '%s\n' "- Repo: \`$ROOT\`"
  printf '%s\n' "- Branch: \`$branch\`"
  printf '%s\n' "- Changed files: \`$changed_count\`"
  printf '%s\n' "- Workflow run: \`$run_id\`"
  printf '%s\n' "- Run HEAD: \`$head_sha\`"
  printf '%s\n' "- Run dirty hash: \`$dirty_hash\`"
  printf '%s\n\n' "- Serena local HTTP MCP: \`$serena_status\`"

  printf '## Summary\n\n'
  if [ -n "$SUMMARY" ]; then
    printf '%s\n\n' "$SUMMARY"
  else
    printf 'No summary was provided. Read the status report and current git diff before continuing.\n\n'
  fi

  printf '## Next Step\n\n'
  if [ -n "$NEXT_STEP" ]; then
    printf '%s\n\n' "$NEXT_STEP"
  else
    printf 'Continue from the latest workflow status and verify current git changes before editing.\n\n'
  fi

  printf '## Current Git Status\n\n'
  status="$(git status --short 2>/dev/null || true)"
  if [ -n "$status" ]; then
    printf '```text\n%s\n```\n\n' "$status"
  else
    printf 'Working tree is clean.\n\n'
  fi

  printf '## Current Run Evidence\n\n'
  node "$EVIDENCE" report

  printf '## Workflow Evidence Files\n\n'
  printf '%s\n' "- Latest status: \`$STATE_DIR/latest-status.md\`"
  printf '%s\n' "- Latest review log: \`$STATE_DIR/latest-review.log\`"
  printf '%s\n' "- Current run metadata: \`$run_dir/metadata.json\`"
  printf '%s\n' "- Current run events: \`$run_dir/events.jsonl\`"
  printf '%s\n\n' "- This handoff archive: \`$archive_file\`"

  printf '## Handoff Instructions\n\n'
  printf '%s\n' "1. Read this handoff first, then run \`pnpm workflow:status\`."
  printf '%s\n' "2. Keep the workflow \`codex-led\`; Codex remains edit owner."
  printf '%s\n' "3. Use Serena for symbol/reference lookup when available and record real tool use."
  printf '%s\n' "4. Delegate only when user-authorized; never use Spark, and record actual agent ID/model."
  printf '%s\n' "5. Run \`pnpm workflow:review -- --full\` before claiming completion."
} | tee "$LATEST_HANDOFF" >"$archive_file"

printf '[ok] Handoff written to %s\n' "$LATEST_HANDOFF"
printf '[ok] Handoff archived at %s\n' "$archive_file"
