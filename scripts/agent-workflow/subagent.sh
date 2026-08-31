#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${HARNSS_WORKFLOW_STATE_DIR:-$ROOT/.harnss/agent-workflow}"
ASSIGNMENTS="$STATE_DIR/subagent-assignments.tsv"
LATEST_ASSIGNMENTS="$STATE_DIR/latest-subagent-assignments.md"
LOCK_DIR="$STATE_DIR/subagent-assignments.lock"

mkdir -p "$STATE_DIR"
cd "$ROOT" || exit 1

usage() {
  cat <<'EOF'
Usage:
  pnpm workflow:subagent -- assign <agent-name> --owns <paths> --task <task> [--model <model>] [--agent-id <id>] [--scope <scope>]
  pnpm workflow:subagent -- complete <agent-name> --summary <result-summary>
  pnpm workflow:subagent -- list

Examples:
  pnpm workflow:subagent -- assign project-coder --model project_coder_medium --agent-id <id> --owns "src/hooks/session" --task "Implement scoped hook tests"
  pnpm workflow:subagent -- assign reviewer --owns "readonly:src/hooks/session" --task "Validate hook split"
  pnpm workflow:subagent -- complete docs-researcher --summary "Found permission docs and cited paths"

Use comma-separated paths for multiple owned scopes. Paths are canonicalized
inside the repository before overlap checks. Prefix read-only scopes with
readonly:. Spark models and names are rejected for this repository.
EOF
}

now() {
  date '+%Y-%m-%d %H:%M:%S %Z'
}

lock_acquired=0

release_lock() {
  if [ "$lock_acquired" -eq 1 ]; then
    LOCK_DIR="$LOCK_DIR" node -e 'require("node:fs").rmSync(process.env.LOCK_DIR, { recursive: true, force: true })' >/dev/null 2>&1 || true
    lock_acquired=0
  fi
}

acquire_lock() {
  local attempts=0
  while ! mkdir "$LOCK_DIR" >/dev/null 2>&1; do
    lock_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    lock_started="$(cat "$LOCK_DIR/started" 2>/dev/null || true)"
    now_epoch="$(date +%s)"
    case "$lock_started" in
      ''|*[!0-9]*) lock_age=31 ;;
      *) lock_age=$((now_epoch - lock_started)) ;;
    esac
    if { [ -z "$lock_pid" ] || ! kill -0 "$lock_pid" >/dev/null 2>&1; } && [ "$lock_age" -gt 30 ]; then
      LOCK_DIR="$LOCK_DIR" node -e 'require("node:fs").rmSync(process.env.LOCK_DIR, { recursive: true, force: true })'
      continue
    fi
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 100 ]; then
      printf '[warn] Timed out waiting for subagent assignment ledger lock: %s\n' "$LOCK_DIR"
      exit 1
    fi
    sleep 0.1
  done
  printf '%s\n' "$$" >"$LOCK_DIR/pid"
  date +%s >"$LOCK_DIR/started"
  lock_acquired=1
  trap release_lock EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

trim_space() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

normalize_owned_path() {
  local path="$1"
  local mode=""
  path="$(trim_space "$path")"
  if [ -z "$path" ]; then
    printf 'Owned path must not be empty.\n' >&2
    return 1
  fi
  case "$path" in
    readonly:*) mode="readonly:"; path="${path#readonly:}" ;;
    read-only:*) mode="readonly:"; path="${path#read-only:}" ;;
  esac
  canonical="$(ROOT="$ROOT" OWNED_PATH="$path" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = fs.realpathSync(process.env.ROOT);
const requested = path.resolve(root, process.env.OWNED_PATH || ".");
let cursor = requested;
const suffix = [];
while (!fs.existsSync(cursor)) {
  const parent = path.dirname(cursor);
  if (parent === cursor) break;
  suffix.unshift(path.basename(cursor));
  cursor = parent;
}
const resolved = path.resolve(fs.realpathSync(cursor), ...suffix);
if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
  process.stderr.write(`Owned path escapes repository: ${process.env.OWNED_PATH}\n`);
  process.exit(1);
}
process.stdout.write(path.relative(root, resolved) || ".");
NODE
)" || return 1
  if [ -z "$canonical" ]; then
    canonical="."
  fi
  printf '%s%s' "$mode" "$canonical"
}

reject_control_chars() {
  local label="$1"
  local value="$2"
  case "$value" in
    *$'\t'*|*$'\n'*|*$'\r'*)
      printf '[error] %s must not contain tabs or newlines.\n' "$label"
      exit 1
      ;;
  esac
}

is_readonly_scope() {
  case "$1" in
    readonly:*|read-only:*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

strip_scope_mode() {
  local path="$1"
  path="${path#readonly:}"
  path="${path#read-only:}"
  normalize_owned_path "$path"
}

paths_overlap() {
  local left
  local right
  left="$(strip_scope_mode "$1")"
  right="$(strip_scope_mode "$2")"

  if [ -z "$left" ] || [ -z "$right" ]; then
    return 1
  fi
  if [ "$left" = "." ] || [ "$right" = "." ]; then
    return 0
  fi
  [ "$left" = "$right" ] && return 0
  case "$left/" in
    "$right/"*) return 0 ;;
  esac
  case "$right/" in
    "$left/"*) return 0 ;;
  esac
  return 1
}

write_latest_assignments() {
  local row_agent row_owns row_scope row_status row_task row_timestamp
  {
    printf '# Harnss Subagent Assignments\n\n'
    printf '%s\n\n' "- Generated: \`$(now)\`"
    if [ ! -s "$ASSIGNMENTS" ]; then
      printf 'No subagent assignments recorded yet.\n'
      return
    fi

    printf '| Time | Status | Agent | Owned Paths | Scope | Task / Summary |\n'
    printf '| --- | --- | --- | --- | --- | --- |\n'
    while IFS=$'\t' read -r row_timestamp row_status row_agent row_owns row_scope row_task; do
      printf '| `%s` | `%s` | `%s` | `%s` | `%s` | %s |\n' "$row_timestamp" "$row_status" "$row_agent" "$row_owns" "$row_scope" "$row_task"
    done <"$ASSIGNMENTS"
  } >"$LATEST_ASSIGNMENTS"
}

cmd="${1:-}"
if [ "$cmd" = "--" ]; then
  shift
  cmd="${1:-}"
fi

case "$cmd" in
  --help|-h|"")
    usage
    exit 0
    ;;
esac
shift || true

case "$cmd" in
  assign)
    if [ "$#" -lt 1 ]; then
      usage
      exit 1
    fi
    agent="$1"
    shift
    owns=""
    task=""
    scope=""
    model=""
    agent_id=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --owns)
          shift
          owns="${1:-}"
          shift || true
          ;;
        --task)
          shift
          task="${1:-}"
          shift || true
          ;;
        --scope)
          shift
          scope="${1:-}"
          shift || true
          ;;
        --model)
          shift
          model="${1:-}"
          shift || true
          ;;
        --agent-id)
          shift
          agent_id="${1:-}"
          shift || true
          ;;
        *)
          if [ -z "$task" ]; then
            task="$1"
          else
            task="$task $1"
          fi
          shift
          ;;
      esac
    done

    if [ -z "$owns" ] || [ -z "$task" ]; then
      usage
      exit 1
    fi

    reject_control_chars "agent name" "$agent"
    reject_control_chars "owned paths" "$owns"
    reject_control_chars "task" "$task"
    reject_control_chars "scope" "$scope"
    reject_control_chars "model" "$model"
    reject_control_chars "agent ID" "$agent_id"

    case "${agent}:${model}" in
      *[Ss][Pp][Aa][Rr][Kk]*)
        printf '[error] Spark delegation is prohibited for this repository.\n'
        exit 1
        ;;
    esac

    IFS=',' read -r -a requested_paths <<<"$owns"
    normalized_paths=()
    for requested_path in "${requested_paths[@]}"; do
      normalized_path="$(normalize_owned_path "$requested_path")" || exit 1
      normalized_paths+=("$normalized_path")
    done
    owns="$(IFS=','; printf '%s' "${normalized_paths[*]}")"
    scope="${scope:-unspecified};model=${model:-unspecified};agentId=${agent_id:-unspecified}"

    acquire_lock
    IFS=',' read -r -a new_paths <<<"$owns"
    if [ -s "$ASSIGNMENTS" ]; then
      while IFS=$'\t' read -r existing_time existing_status existing_agent existing_owns existing_scope existing_task; do
        [ "$existing_status" = "active" ] || continue
        if [ "$existing_agent" = "$agent" ]; then
          printf '[warn] Refusing multiple active assignments for the same subagent: %s\n' "$agent"
          printf '[warn] Existing active scope: %s since %s\n' "$existing_owns" "$existing_time"
          printf '[info] Complete the existing assignment first, or use a distinct agent name/nickname for parallel work.\n'
          exit 1
        fi
        IFS=',' read -r -a existing_paths <<<"$existing_owns"
        for new_path in "${new_paths[@]}"; do
          new_path="$(normalize_owned_path "$new_path")"
          is_readonly_scope "$new_path" && continue
          for existing_path in "${existing_paths[@]}"; do
            existing_path="$(normalize_owned_path "$existing_path")"
            is_readonly_scope "$existing_path" && continue
            if paths_overlap "$new_path" "$existing_path"; then
              printf '[warn] Refusing overlapping active subagent ownership.\n'
              printf '[warn] New: %s owns %s\n' "$agent" "$new_path"
              printf '[warn] Existing: %s owns %s since %s\n' "$existing_agent" "$existing_path" "$existing_time"
              printf '[info] Use a disjoint --owns path, readonly: scope, or complete the existing assignment first.\n'
              exit 1
            fi
          done
        done
      done <"$ASSIGNMENTS"
    fi

    printf '%s\tactive\t%s\t%s\t%s\t%s\n' "$(now)" "$agent" "$owns" "${scope:-unspecified}" "$task" >>"$ASSIGNMENTS"
    write_latest_assignments
    printf '[ok] Assigned %s with owned scope: %s\n' "$agent" "$owns"
    printf '[ok] Assignment ledger: %s\n' "$LATEST_ASSIGNMENTS"
    ;;

  complete)
    if [ "$#" -lt 1 ]; then
      usage
      exit 1
    fi
    agent="$1"
    shift
    summary=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --summary)
          shift
          summary="${1:-}"
          shift || true
          ;;
        *)
          if [ -z "$summary" ]; then
            summary="$1"
          else
            summary="$summary $1"
          fi
          shift
          ;;
      esac
    done

    if [ -z "$summary" ]; then
      usage
      exit 1
    fi
    reject_control_chars "agent name" "$agent"
    reject_control_chars "completion summary" "$summary"

    acquire_lock
    completed_existing=0
    if [ -s "$ASSIGNMENTS" ]; then
      tmp="$STATE_DIR/subagent-assignments.$$.tmp"
      while IFS=$'\t' read -r existing_time existing_status existing_agent existing_owns existing_scope existing_task; do
        if [ "$existing_status" = "active" ] && [ "$existing_agent" = "$agent" ]; then
          completed_existing=1
          printf '%s\tcomplete\t%s\t%s\t%s\t%s | Completed: %s\n' "$existing_time" "$existing_agent" "$existing_owns" "$existing_scope" "$existing_task" "$summary"
        else
          printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$existing_time" "$existing_status" "$existing_agent" "$existing_owns" "$existing_scope" "$existing_task"
        fi
      done <"$ASSIGNMENTS" >"$tmp"
      mv "$tmp" "$ASSIGNMENTS"
    fi

    if [ "$completed_existing" -eq 0 ]; then
      printf '[warn] Refusing to record subagent completion without an active assignment: %s\n' "$agent"
      printf '[info] Run `pnpm workflow:subagent -- assign %s --owns <paths> --task <task>` before delegated work starts.\n' "$agent"
      exit 1
    fi

    bash scripts/agent-workflow/record.sh subagent "$agent" "$summary"
    write_latest_assignments
    printf '[ok] Completed %s and recorded subagent evidence\n' "$agent"
    ;;

  list)
    write_latest_assignments
    cat "$LATEST_ASSIGNMENTS"
    ;;

  *)
    printf '[warn] Unknown workflow:subagent command: %s\n' "$cmd"
    usage
    exit 1
    ;;
esac
