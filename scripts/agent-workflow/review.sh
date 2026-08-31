#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${HARNSS_WORKFLOW_STATE_DIR:-$ROOT/.harnss/agent-workflow}"
EVIDENCE="$ROOT/scripts/agent-workflow/evidence.mjs"
mkdir -p "$STATE_DIR"

if [ -d "$HOME/.local/bin" ]; then
  PATH="$HOME/.local/bin:$PATH"
fi
if [ -d "$HOME/Library/pnpm/.tools/pnpm/10.26.0/bin" ]; then
  PATH="$HOME/Library/pnpm/.tools/pnpm/10.26.0/bin:$PATH"
fi
export PATH

MODE="full"
KEEP_GOING=0
LIST_ONLY=0

usage() {
  cat <<'EOF'
Usage: pnpm workflow:review [-- --fast|--full|--ci] [--keep-going] [--list-gates]

Modes:
  --fast  Workflow tests, Pi reference checks, unit tests, typecheck, Semgrep,
          and diff validation.
  --full  Default. Adds build, docs, test-map, real Pi child integration,
          Electron recovery E2E, and Pi runtime checks. It never packages.
  --ci    GitHub Actions only. Adds Playwright UI, Linux package, and packaged
          smoke checks. Refuses to run outside GitHub Actions on Linux.

Every executed gate is fail-closed and records run ID, HEAD, dirty hash, and
exit code. Use WORKFLOW_GATE_FILTER or WORKFLOW_FAIL_GATE only from workflow
self-tests.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --)
      ;;
    --fast)
      MODE="fast"
      ;;
    --full)
      MODE="full"
      ;;
    --ci)
      MODE="ci"
      ;;
    --keep-going)
      KEEP_GOING=1
      ;;
    --list-gates)
      LIST_ONLY=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf '[error] Unknown workflow:review argument: %s\n' "$arg"
      usage
      exit 2
      ;;
  esac
done

if [ "$MODE" = "ci" ]; then
  if [ "${GITHUB_ACTIONS:-false}" != "true" ] || [ "$(uname -s)" != "Linux" ]; then
    printf '[error] --ci includes packaging and is restricted to GitHub Actions on Linux.\n'
    printf '[info] Use --full for the complete non-packaging local gate set.\n'
    exit 2
  fi
fi

FAST_GATES=(
  doctor
  workflow-tests
  pi-reference
  pi-benchmark
  unit-tests
  typecheck
  semgrep
  diff-check
)
FULL_ONLY_GATES=(
  build
  docs-check
  test-map
  pi-integration
  electron-recovery
  pi-runtime
)
CI_ONLY_GATES=(
  ui-e2e
  package-linux
  package-smoke
)

GATES=("${FAST_GATES[@]}")
if [ "$MODE" != "fast" ]; then
  GATES+=("${FULL_ONLY_GATES[@]}")
fi
if [ "$MODE" = "ci" ]; then
  GATES+=("${CI_ONLY_GATES[@]}")
fi

if [ "$LIST_ONLY" -eq 1 ]; then
  printf 'mode=%s\n' "$MODE"
  printf '%s\n' "${GATES[@]}"
  exit 0
fi

if { [ -n "${WORKFLOW_GATE_FILTER:-}" ] || [ -n "${WORKFLOW_FAIL_GATE:-}" ]; } \
  && [ "${WORKFLOW_SELF_TEST:-0}" != "1" ]; then
  printf '[error] WORKFLOW_GATE_FILTER and WORKFLOW_FAIL_GATE are restricted to workflow self-tests.\n'
  exit 2
fi

cd "$ROOT" || exit 1

if [ "${WORKFLOW_NO_TEE:-0}" != "1" ]; then
  exec 3>&1 4>&2
  exec >"$STATE_DIR/latest-review.log" 2>&1
  trap 'status=$?; exec 1>&3 2>&4; cat "$STATE_DIR/latest-review.log"; exit "$status"' EXIT
fi

if [ ! -f "$EVIDENCE" ]; then
  printf '[error] Required workflow evidence recorder is missing: %s\n' "$EVIDENCE"
  exit 1
fi
REVIEW_RUN_ID="$(node "$EVIDENCE" start "workflow review mode=$MODE")" || exit 1
printf '[info] evidence run: %s\n' "$REVIEW_RUN_ID"

gate_selected() {
  local gate="$1"
  local filter=",${WORKFLOW_GATE_FILTER:-},"
  [ "${WORKFLOW_GATE_FILTER:-}" = "" ] && return 0
  case "$filter" in
    *",$gate,"*) return 0 ;;
    *) return 1 ;;
  esac
}

record_gate() {
  local gate="$1"
  local exit_code="$2"
  local summary="$3"
  node "$EVIDENCE" record gate "$gate" "$exit_code" "$summary" >/dev/null
}

run_semgrep() (
  mkdir -p "$STATE_DIR/semgrep-config" "$STATE_DIR/semgrep-cache"
  if [ -f "/etc/ssl/cert.pem" ]; then
    export SSL_CERT_FILE="${SSL_CERT_FILE:-/etc/ssl/cert.pem}"
    export REQUESTS_CA_BUNDLE="${REQUESTS_CA_BUNDLE:-/etc/ssl/cert.pem}"
    export GIT_SSL_CAINFO="${GIT_SSL_CAINFO:-/etc/ssl/cert.pem}"
  fi
  export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$STATE_DIR/semgrep-config}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$STATE_DIR/semgrep-cache}"
  export SEMGREP_LOG_FILE="${SEMGREP_LOG_FILE:-$STATE_DIR/semgrep.log}"
  export SEMGREP_SETTINGS_FILE="${SEMGREP_SETTINGS_FILE:-$STATE_DIR/semgrep-settings.yml}"
  export SEMGREP_SEND_METRICS=off
  export SEMGREP_ENABLE_VERSION_CHECK=0
  semgrep scan --metrics=off --error --config .semgrep.yml .
)

run_gate_command() {
  local gate="$1"
  if [ "${WORKFLOW_FAIL_GATE:-}" = "$gate" ]; then
    printf '[test] Injected failure for gate %s\n' "$gate"
    return 97
  fi
  case "$gate" in
    doctor)
      WORKFLOW_NO_TEE=1 bash scripts/agent-workflow/doctor.sh
      ;;
    workflow-tests)
      pnpm test:agent-workflow
      ;;
    pi-reference)
      node scripts/agent-workflow/pi-reference.mjs check
      ;;
    pi-benchmark)
      node scripts/agent-workflow/pi-reference.mjs benchmark
      ;;
    unit-tests)
      pnpm exec vitest run --config vitest.config.electron.ts
      ;;
    typecheck)
      pnpm typecheck
      ;;
    semgrep)
      run_semgrep
      ;;
    diff-check)
      git diff --check
      ;;
    build)
      pnpm build
      ;;
    docs-check)
      pnpm docs:check
      ;;
    test-map)
      pnpm test-map:check
      ;;
    pi-integration)
      pnpm test:pi-integration
      ;;
    electron-recovery)
      pnpm test:electron-recovery
      ;;
    pi-runtime)
      PI_RUNTIME_DOCTOR_CATALOG="$ROOT/scripts/fixtures/pi-doctor-catalog.json" \
        PI_RUNTIME_DOCTOR_CREDENTIAL_PRESENT=true \
        pnpm pi:runtime:check
      ;;
    ui-e2e)
      xvfb-run -a pnpm test:ui
      ;;
    package-linux)
      pnpm exec electron-builder --config electron-builder.config.js --config.npmRebuild=false --linux --dir --publish never
      ;;
    package-smoke)
      local version
      version="$(node -p "require('./package.json').version")"
      xvfb-run -a pnpm package:smoke -- "release/$version"
      ;;
    *)
      printf '[error] Unknown gate: %s\n' "$gate"
      return 2
      ;;
  esac
}

printf '== Harnss Pi-first review ==\n'
printf '[info] mode: %s\n' "$MODE"
printf '[info] repo: %s\n' "$ROOT"
printf '[info] packaging: %s\n' "$(if [ "$MODE" = "ci" ]; then printf 'GitHub Actions Linux only'; else printf 'disabled locally'; fi)"
printf '[info] changed files: %s\n' "$(git status --short --untracked-files=all | wc -l | tr -d ' ')"

failures=0
executed=0
passed=0
for gate in "${GATES[@]}"; do
  gate_selected "$gate" || continue
  executed=$((executed + 1))
  printf '\n[%s/%s] %s\n' "$executed" "${#GATES[@]}" "$gate"
  started="$(date +%s)"
  gate_exit=0
  run_gate_command "$gate" || gate_exit=$?
  elapsed=$(( $(date +%s) - started ))
  if [ "$gate_exit" -eq 0 ]; then
    printf '[ok] %s passed in %ss\n' "$gate" "$elapsed"
    if record_gate "$gate" 0 "passed in ${elapsed}s"; then
      passed=$((passed + 1))
    else
      failures=$((failures + 1))
      printf '[error] %s passed, but its evidence record failed\n' "$gate"
      [ "$KEEP_GOING" -eq 0 ] && break
    fi
  else
    failures=$((failures + 1))
    printf '[error] %s failed with exit code %s after %ss\n' "$gate" "$gate_exit" "$elapsed"
    if ! record_gate "$gate" "$gate_exit" "failed in ${elapsed}s"; then
      printf '[error] %s failure evidence could not be recorded\n' "$gate"
    fi
    if [ "$KEEP_GOING" -eq 0 ]; then
      break
    fi
  fi
done

if [ "$executed" -eq 0 ]; then
  failures=$((failures + 1))
  printf '[error] No review gates were selected.\n'
fi

printf '\n== Review summary ==\n'
printf 'mode=%s executed=%s passed=%s failed=%s\n' "$MODE" "$executed" "$passed" "$failures"
if [ "$MODE" != "ci" ]; then
  printf '[info] Local review intentionally excludes packaging. Packaging remains a required GitHub Actions gate.\n'
fi
if [ -f ".code-review-graph/graph.db" ]; then
  printf '[info] Run Codex code-review-graph impact analysis and record the actual response before final completion.\n'
fi

if [ "$failures" -gt 0 ]; then
  node "$EVIDENCE" finish failed "mode=$MODE executed=$executed passed=$passed failed=$failures" >/dev/null || true
  exit 1
fi
if ! node "$EVIDENCE" finish passed "mode=$MODE executed=$executed passed=$passed failed=0" >/dev/null; then
  printf '[error] Review gates passed, but final evidence could not be persisted.\n'
  exit 1
fi
exit 0
