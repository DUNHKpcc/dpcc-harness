#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE="$ROOT/scripts/agent-workflow/evidence.mjs"
cd "$ROOT" || exit 1

usage() {
  cat <<'EOF'
Usage:
  pnpm workflow:hook -- session-start [summary]
  pnpm workflow:hook -- pre-tool-use <tool-name> [intent]
  pnpm workflow:hook -- post-tool-use <tool-name> [result-summary]
  pnpm workflow:hook -- post-edit [summary]
  pnpm workflow:hook -- subagent-stop <agent-name> <result-summary>
  pnpm workflow:hook -- pre-compact [summary]
  pnpm workflow:hook -- stop [summary]
EOF
}

if [ "${1:-}" = "--" ]; then shift; fi
event="${1:-}"
if [ -z "$event" ] || [ "$event" = "--help" ] || [ "$event" = "-h" ]; then
  usage
  [ -n "$event" ] && exit 0
  exit 1
fi
shift

record() {
  node "$EVIDENCE" record "$1" "$2" "$3" "$4" >/dev/null
}

case "$event" in
  session-start)
    summary="${*:-Harnss Pi-first workflow session started}"
    run_id="$(node "$EVIDENCE" start "$summary")"
    printf '[ok] Started workflow run %s\n' "$run_id"
    doctor_exit=0
    WORKFLOW_NO_TEE=1 bash scripts/agent-workflow/doctor.sh || doctor_exit=$?
    record gate doctor "$doctor_exit" "session-start preflight"
    if [ "$doctor_exit" -ne 0 ]; then
      node "$EVIDENCE" finish failed "session-start preflight failed" >/dev/null || true
    fi
    exit "$doctor_exit"
    ;;
  pre-tool-use)
    [ "$#" -ge 1 ] || { usage; exit 1; }
    tool_name="$1"
    shift
    record pre-tool-use "$tool_name" - "${*:-Tool is about to run}"
    printf '[ok] Recorded pre-tool-use for %s\n' "$tool_name"
    ;;
  post-tool-use)
    [ "$#" -ge 1 ] || { usage; exit 1; }
    tool_name="$1"
    shift
    summary="${*:-Tool completed}"
    record post-tool-use "$tool_name" - "$summary"
    case "$tool_name" in
      mcp__serena__*|mcp__serena.*)
        bash scripts/agent-workflow/record.sh serena "$tool_name" "$summary"
        ;;
      mcp__code_review_graph__*|mcp__code_review_graph.*)
        bash scripts/agent-workflow/record.sh code-review-graph "$tool_name" "$summary"
        ;;
    esac
    printf '[ok] Recorded post-tool-use for %s\n' "$tool_name"
    ;;
  post-edit)
    summary="${*:-Code edits completed; verify focused and full gates}"
    record post-edit changed-files - "$summary"
    git status --short
    printf '[info] Run pnpm workflow:review -- --fast, then --full before completion.\n'
    ;;
  subagent-stop)
    [ "$#" -ge 2 ] || { usage; exit 1; }
    agent_name="$1"
    shift
    bash scripts/agent-workflow/subagent.sh complete "$agent_name" --summary "$*"
    ;;
  pre-compact)
    summary="${*:-Context compaction or session switch is approaching}"
    record pre-compact handoff - "$summary"
    bash scripts/agent-workflow/handoff.sh --to "next Codex session" --summary "$summary" --next "Read the current run evidence and continue without assuming stale logs are current."
    ;;
  stop)
    summary="${*:-Codex turn is ending}"
    record stop status - "$summary"
    bash scripts/agent-workflow/status.sh
    ;;
  *)
    printf '[error] Unknown workflow hook event: %s\n' "$event"
    usage
    exit 1
    ;;
esac
