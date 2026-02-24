#!/usr/bin/env bash
set -euo pipefail

# If invoked via sh/dash by accident, re-exec with bash.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi

# Load interactive shell env when available (aliases/sdkman/path setup).
if [[ -f "$HOME/.bashrc" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "$HOME/.bashrc"
  set -u
fi

# Run unchecked Ralph tasks for one phase through ralphy.
# Default behavior matches review-first workflow:
# - scope to one phase
# - skip REVIEW GATE lines
# - run with --codex --no-commit

TASKS_FILE="${TASKS_FILE:-.ralph/feature/current/TASKS.md}"
PHASE_NUM="${1:-}"
LIST_ONLY="${LIST_ONLY:-0}"
ENGINE_FLAG="${ENGINE_FLAG:---codex}"
NO_COMMIT_FLAG="${NO_COMMIT_FLAG:---no-commit}"
RALPHY_MAX_RETRIES="${RALPHY_MAX_RETRIES:-6}"
RALPHY_RETRY_DELAY="${RALPHY_RETRY_DELAY:-10}"
CONTINUE_ON_ERROR="${CONTINUE_ON_ERROR:-1}"
MAX_TASKS="${MAX_TASKS:-0}" # 0 = unlimited
ATOMICITY_MODE="${ATOMICITY_MODE:-off}"                # off|phase|loop
ATOMICITY_ENFORCEMENT="${ATOMICITY_ENFORCEMENT:-warn}" # warn|enforce
ATOMICITY_CHECKER="${ATOMICITY_CHECKER:-scripts/check_task_atomicity.sh}"

usage() {
  cat <<'EOF'
Usage:
  scripts/run_phase_tasks.sh <phase-number>

Examples:
  scripts/run_phase_tasks.sh 1
  LIST_ONLY=1 scripts/run_phase_tasks.sh 1
  TASKS_FILE=/path/to/TASKS.md scripts/run_phase_tasks.sh 2

Environment overrides:
  TASKS_FILE     Path to TASKS.md (default: .ralph/feature/current/TASKS.md)
  LIST_ONLY      1 = print selected tasks only, do not execute
  ENGINE_FLAG    ralphy engine selector (default: --codex)
  NO_COMMIT_FLAG commit behavior flag (default: --no-commit)
  RALPHY_MAX_RETRIES retries per task (default: 6)
  RALPHY_RETRY_DELAY retry delay seconds (default: 10)
  CONTINUE_ON_ERROR 1 = continue phase on task failure, 0 = stop immediately
  MAX_TASKS      Maximum tasks to execute for this phase (0 = all)
  ATOMICITY_MODE off|phase|loop (default: off)
  ATOMICITY_ENFORCEMENT warn|enforce (default: warn)
  ATOMICITY_CHECKER path to checker script (default: scripts/check_task_atomicity.sh)
EOF
}

if [[ -z "$PHASE_NUM" ]] || [[ "$PHASE_NUM" == "-h" ]] || [[ "$PHASE_NUM" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! "$PHASE_NUM" =~ ^[0-9]+$ ]]; then
  echo "ERROR: phase-number must be numeric (got '$PHASE_NUM')" >&2
  exit 1
fi

if [[ ! -f "$TASKS_FILE" ]]; then
  echo "ERROR: tasks file not found: $TASKS_FILE" >&2
  exit 1
fi

has_phase_headers=0
if awk '/^## Phase [0-9]+/ { found=1; exit } END { exit found ? 0 : 1 }' "$TASKS_FILE"; then
  has_phase_headers=1
fi

if [[ "$has_phase_headers" -eq 0 ]] && [[ "$PHASE_NUM" != "1" ]]; then
  echo "No phase headers in $TASKS_FILE; only synthetic Phase 1 is available (requested: $PHASE_NUM)"
  exit 0
fi

if [[ "$ATOMICITY_MODE" != "off" ]]; then
  if [[ ! -x "$ATOMICITY_CHECKER" ]]; then
    echo "ERROR: atomicity checker is not executable: $ATOMICITY_CHECKER" >&2
    exit 1
  fi
  TASKS_FILE="$TASKS_FILE" \
  ATOMICITY_MODE="$ATOMICITY_MODE" \
  ATOMICITY_ENFORCEMENT="$ATOMICITY_ENFORCEMENT" \
  "$ATOMICITY_CHECKER" "$PHASE_NUM" "$PHASE_NUM"
fi

if ! command -v ralphy >/dev/null 2>&1; then
  echo "ERROR: ralphy not found in PATH" >&2
  exit 1
fi

mapfile -t task_entries < <(
  awk -v phase="$PHASE_NUM" -v has_headers="$has_phase_headers" '
    BEGIN { in_phase=(has_headers ? 0 : (phase == 1)) }
    $0 ~ ("^## Phase " phase "($|[[:space:]-])") { in_phase=1; next }
    in_phase && $0 ~ /^## Phase [0-9]+/ { exit }
    in_phase && $0 ~ /^- \[ \] / {
      sub(/^- \[ \] /, "", $0)
      if ($0 !~ /^REVIEW GATE:/) print NR "\t" $0
    }
  ' "$TASKS_FILE"
)

if [[ "${#task_entries[@]}" -eq 0 ]]; then
  echo "No unchecked executable tasks found for Phase $PHASE_NUM in $TASKS_FILE"
  exit 0
fi

echo "Phase $PHASE_NUM tasks selected: ${#task_entries[@]}"
for i in "${!task_entries[@]}"; do
  IFS=$'\t' read -r _line raw_task <<<"${task_entries[$i]}"
  printf '%2d. %s\n' "$((i + 1))" "$raw_task"
done

if [[ "$LIST_ONLY" == "1" ]]; then
  exit 0
fi

if [[ ! "$MAX_TASKS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: MAX_TASKS must be numeric (got '$MAX_TASKS')" >&2
  exit 1
fi

engine_to_flag() {
  local engine="$1"
  case "$engine" in
    ""|codex) echo "--codex" ;;
    claude)   echo "--claude" ;;
    opencode) echo "--opencode" ;;
    cursor)   echo "--cursor" ;;
    qwen)     echo "--qwen" ;;
    droid)    echo "--droid" ;;
    copilot)  echo "--copilot" ;;
    gemini)   echo "--gemini" ;;
    *)
      echo "ERROR: unsupported engine '$engine'" >&2
      return 1
      ;;
  esac
}

mark_task_done() {
  local task_line="$1"
  local raw_line="$2"
  TASK_LINE="$task_line" TASK_RAW_LINE="$raw_line" perl -i -pe '
    our $done;
    if (!$done && $. == $ENV{TASK_LINE}) {
      if (s/^- \[ \] \Q$ENV{TASK_RAW_LINE}\E$/- [x] $ENV{TASK_RAW_LINE}/) {
        $done = 1;
      }
    }
    if (!$done && s/^- \[ \] \Q$ENV{TASK_RAW_LINE}\E$/- [x] $ENV{TASK_RAW_LINE}/) {
      $done = 1;
    }
  ' "$TASKS_FILE"
}

failed_tasks=()
executed_tasks=0
attempted_tasks=0

for entry in "${task_entries[@]}"; do
  if (( MAX_TASKS > 0 && attempted_tasks >= MAX_TASKS )); then
    echo "Reached MAX_TASKS=$MAX_TASKS for Phase $PHASE_NUM; stopping early."
    break
  fi

  attempted_tasks=$((attempted_tasks + 1))
  IFS=$'\t' read -r task_line raw_task <<<"$entry"
  task="$raw_task"
  meta=""
  engine=""
  model=""
  effort=""
  engine_flag="$ENGINE_FLAG"

  if [[ "$raw_task" =~ ^\[([^]]+)\][[:space:]]+(.+)$ ]]; then
    meta="${BASH_REMATCH[1]}"
    task="${BASH_REMATCH[2]}"
    for kv in $meta; do
      case "$kv" in
        engine=*) engine="${kv#engine=}" ;;
        model=*)  model="${kv#model=}" ;;
        effort=*) effort="${kv#effort=}" ;;
      esac
    done
    engine_flag="$(engine_to_flag "$engine")"
  fi

  cmd=(ralphy "$task" "$engine_flag" --max-retries "$RALPHY_MAX_RETRIES" --retry-delay "$RALPHY_RETRY_DELAY")
  if [[ -n "$model" ]]; then
    cmd+=(--model "$model")
  fi
  if [[ -n "$NO_COMMIT_FLAG" ]]; then
    cmd+=("$NO_COMMIT_FLAG")
  fi

  echo ""
  if [[ -n "$meta" ]]; then
    echo ">>> Running: $task"
    echo "    metadata: $meta"
  else
    echo ">>> Running: $task"
    echo "    metadata: engine=codex (default)"
  fi
  set +e
  task_output_file="$(mktemp)"
  "${cmd[@]}" 2>&1 | tee "$task_output_file"
  rc=${PIPESTATUS[0]}
  set -e

  # Guardrail for unattended runs: do not treat clarification prompts as success.
  if [[ "$rc" -eq 0 ]] && rg -qi 'should i proceed|how would you like to proceed|need your confirmation|waiting for your confirmation' "$task_output_file"; then
    echo "    task returned a clarification prompt; treating as failure: $task"
    rc=2
  fi
  rm -f "$task_output_file"

  if [[ "$rc" -ne 0 ]]; then
    echo "    task failed (exit $rc): $task"
    failed_tasks+=("$task")
    if [[ "$CONTINUE_ON_ERROR" == "0" ]]; then
      echo "Stopping because CONTINUE_ON_ERROR=0"
      exit "$rc"
    fi
    continue
  fi

  mark_task_done "$task_line" "$raw_task"
  executed_tasks=$((executed_tasks + 1))
  echo "    marked done in $TASKS_FILE"
done

if [[ "${#failed_tasks[@]}" -gt 0 ]]; then
  echo ""
  echo "Completed with failures: ${#failed_tasks[@]} task(s) failed"
  for i in "${!failed_tasks[@]}"; do
    printf '  %2d. %s\n' "$((i + 1))" "${failed_tasks[$i]}"
  done
  exit 1
fi
