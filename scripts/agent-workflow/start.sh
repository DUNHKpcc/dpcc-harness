#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${HARNSS_WORKFLOW_STATE_DIR:-$ROOT/.harnss/agent-workflow}"
LOG_DIR="$ROOT/logs/agent-workflow"
EVIDENCE="$ROOT/scripts/agent-workflow/evidence.mjs"
SERENA_PORT="${SERENA_PORT:-9121}"
SERENA_PID_FILE="$STATE_DIR/serena.pid"
SERENA_META_FILE="$STATE_DIR/serena-process.json"
SERENA_LOG="$LOG_DIR/serena.log"
HTTP_DEBUG=0

for arg in "$@"; do
  case "$arg" in
    --)
      ;;
    --http-debug)
      HTTP_DEBUG=1
      ;;
    --help|-h)
      cat <<'EOF'
Usage: pnpm workflow:start [-- --http-debug]

Runs fail-closed preflight and starts a new evidence run. Codex uses Serena
through its stdio MCP configuration; no second HTTP Serena process is started
unless --http-debug is explicitly requested.
EOF
      exit 0
      ;;
    *)
      printf '[error] Unknown workflow:start argument: %s\n' "$arg"
      exit 2
      ;;
  esac
done

mkdir -p "$STATE_DIR" "$LOG_DIR"
cd "$ROOT" || exit 1

run_id="$(node "$EVIDENCE" start "Harnss Pi-first workflow started")"
startup_succeeded=0
finish_failed_startup() {
  local exit_code=$?
  trap - EXIT
  if [ "$startup_succeeded" -eq 0 ] && [ "$exit_code" -ne 0 ]; then
    node "$EVIDENCE" finish failed "workflow:start failed with exit code $exit_code" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap finish_failed_startup EXIT
printf '== Harnss Pi-first workflow ==\n'
printf '[info] run ID: %s\n' "$run_id"

doctor_exit=0
WORKFLOW_NO_TEE=1 bash scripts/agent-workflow/doctor.sh || doctor_exit=$?
node "$EVIDENCE" record gate doctor "$doctor_exit" "workflow:start preflight" >/dev/null
if [ "$doctor_exit" -ne 0 ]; then
  printf '[error] Preflight failed; workflow did not start.\n'
  exit "$doctor_exit"
fi

process_matches() {
  local pid="$1"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command" in
    *serena*start-mcp-server*"$ROOT"*) return 0 ;;
    *) return 1 ;;
  esac
}

metadata_matches() {
  local pid="$1"
  [ -f "$SERENA_META_FILE" ] || return 1
  SERENA_META_FILE="$SERENA_META_FILE" SERENA_PID="$pid" ROOT="$ROOT" node <<'NODE'
const fs = require("node:fs");
try {
  const meta = JSON.parse(fs.readFileSync(process.env.SERENA_META_FILE, "utf8"));
  process.exit(meta.pid === Number(process.env.SERENA_PID)
    && meta.root === process.env.ROOT
    && meta.purpose === "explicit-http-debug" ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if [ "$HTTP_DEBUG" -eq 1 ]; then
  if ! command -v python3 >/dev/null 2>&1 || ! command -v serena >/dev/null 2>&1; then
    printf '[error] --http-debug requires python3 and serena.\n'
    exit 1
  fi
  existing_pid="$(cat "$SERENA_PID_FILE" 2>/dev/null || true)"
  if process_matches "$existing_pid"; then
    if ! metadata_matches "$existing_pid"; then
      printf '[error] Matching Serena PID %s lacks valid workflow ownership metadata; refusing to adopt it.\n' "$existing_pid"
      exit 1
    fi
    printf '[ok] Workflow-owned Serena HTTP debug process already running with PID %s\n' "$existing_pid"
  else
    serena_pid="$(
      SERENA_LOG="$SERENA_LOG" SERENA_PORT="$SERENA_PORT" ROOT="$ROOT" python3 <<'PY'
import os
import subprocess

with open(os.environ["SERENA_LOG"], "ab", buffering=0) as log:
    process = subprocess.Popen(
        [
            "serena", "start-mcp-server",
            "--transport", "streamable-http",
            "--port", os.environ["SERENA_PORT"],
            "--project", os.environ["ROOT"],
            "--context", "codex",
            "--enable-web-dashboard", "false",
            "--enable-gui-log-window", "false",
            "--open-web-dashboard", "false",
        ],
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
print(process.pid)
PY
    )"
    printf '%s\n' "$serena_pid" >"$SERENA_PID_FILE"
    SERENA_PID="$serena_pid" SERENA_PORT="$SERENA_PORT" ROOT="$ROOT" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const state = process.env.HARNSS_WORKFLOW_STATE_DIR || path.join(process.env.ROOT, ".harnss/agent-workflow");
fs.writeFileSync(path.join(state, "serena-process.json"), JSON.stringify({
  schemaVersion: 1,
  pid: Number(process.env.SERENA_PID),
  port: Number(process.env.SERENA_PORT),
  root: process.env.ROOT,
  startedAt: new Date().toISOString(),
  purpose: "explicit-http-debug"
}, null, 2) + "\n", { mode: 0o600 });
NODE
    sleep 3
    if ! process_matches "$serena_pid"; then
      printf '[error] Serena HTTP debug process failed to start; see %s\n' "$SERENA_LOG"
      exit 1
    fi
    printf '[ok] Started explicit Serena HTTP debug process with PID %s\n' "$serena_pid"
  fi
  printf '[info] HTTP debug endpoint: http://127.0.0.1:%s/mcp\n' "$SERENA_PORT"
else
  printf '[ok] No duplicate Serena process started. Codex stdio MCP remains the semantic path.\n'
fi

node scripts/agent-workflow/pi-reference.mjs sync >/dev/null
node scripts/agent-workflow/pi-reference.mjs benchmark >/dev/null
node "$EVIDENCE" record benchmark pi-reference 0 "30-scenario Pi retrieval benchmark passed" >/dev/null

printf '[ok] Workflow ready.\n'
printf '[info] Fast checks: pnpm workflow:review -- --fast\n'
printf '[info] Full local checks without packaging: pnpm workflow:review -- --full\n'
printf '[info] Pi query: pnpm workflow:pi-reference -- query "<question>"\n'
startup_succeeded=1
