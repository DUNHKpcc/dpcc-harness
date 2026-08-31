#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${HARNSS_WORKFLOW_STATE_DIR:-$ROOT/.harnss/agent-workflow}"
PID_FILE="$STATE_DIR/serena.pid"
META_FILE="$STATE_DIR/serena-process.json"

if [ ! -f "$PID_FILE" ]; then
  printf '[ok] No workflow-owned Serena HTTP debug process is recorded.\n'
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ ! -f "$META_FILE" ]; then
  printf '[warn] Refusing to stop an unverified legacy PID record: %s\n' "${pid:-missing}"
  printf '[info] Only processes started explicitly with workflow:start -- --http-debug are owned by this command.\n'
  exit 1
fi
case "$pid" in
  ''|*[!0-9]*)
    printf '[warn] Refusing to stop an invalid PID record: %s\n' "${pid:-missing}"
    exit 1
    ;;
esac

verification="$(META_FILE="$META_FILE" PID="$pid" ROOT="$ROOT" node <<'NODE'
const fs = require("node:fs");
try {
  const meta = JSON.parse(fs.readFileSync(process.env.META_FILE, "utf8"));
  process.stdout.write(String(
    meta.pid === Number(process.env.PID) &&
    meta.root === process.env.ROOT &&
    meta.purpose === "explicit-http-debug"
  ));
} catch {
  process.stdout.write("false");
}
NODE
)"
if [ "$verification" != "true" ]; then
  printf '[warn] Refusing to stop PID %s because ownership verification failed.\n' "$pid"
  exit 1
fi

cleanup_metadata() {
  PID_FILE="$PID_FILE" META_FILE="$META_FILE" node -e '
    const fs = require("node:fs");
    for (const file of [process.env.PID_FILE, process.env.META_FILE]) fs.rmSync(file, { force: true });
  '
}

if ! kill -0 "$pid" >/dev/null 2>&1; then
  cleanup_metadata
  printf '[ok] Removed stale metadata for workflow-owned Serena PID %s.\n' "$pid"
  exit 0
fi

command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
if [[ "$command" != *serena*start-mcp-server*"$ROOT"* ]]; then
  printf '[warn] Refusing to stop PID %s because its live command does not match the ownership record.\n' "$pid"
  exit 1
fi

kill "$pid"
for _ in 1 2 3 4 5; do
  kill -0 "$pid" >/dev/null 2>&1 || break
  sleep 1
done
if kill -0 "$pid" >/dev/null 2>&1; then
  printf '[error] Serena HTTP debug process %s did not stop.\n' "$pid"
  exit 1
fi

cleanup_metadata
printf '[ok] Stopped workflow-owned Serena HTTP debug process %s.\n' "$pid"
