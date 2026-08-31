#!/usr/bin/env bash
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE="$ROOT/scripts/agent-workflow/evidence.mjs"

usage() {
  cat <<'EOF'
Usage:
  pnpm workflow:record -- serena <tool-name> <summary>
  pnpm workflow:record -- subagent <agent-id-or-name> <summary>
  pnpm workflow:record -- code-review-graph <tool-name> <summary>
  pnpm workflow:record -- benchmark <name> <summary>

Records evidence in the current run with run ID, HEAD, dirty hash, timestamp,
and a null exit code for external tool calls.
EOF
}

if [ "${1:-}" = "--" ]; then shift; fi
if [ "$#" -lt 3 ]; then
  usage
  exit 1
fi

kind="$1"
subject="$2"
shift 2
summary="$*"

case "$kind" in
  serena|subagent|code-review-graph|benchmark)
    ;;
  *)
    printf '[error] Unknown workflow evidence kind: %s\n' "$kind"
    usage
    exit 1
    ;;
esac

run_id="$(node "$EVIDENCE" record "$kind" "$subject" - "$summary")"
printf '[ok] Recorded %s evidence for run %s\n' "$kind" "$run_id"
