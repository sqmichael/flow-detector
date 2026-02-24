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

TASKS_FILE="${TASKS_FILE:-.ralph/feature/current/TASKS.md}"
START_PHASE="${1:-}"
END_PHASE="${2:-}"
LIST_ONLY="${LIST_ONLY:-0}"
CONTINUE_ON_PHASE_ERROR="${CONTINUE_ON_PHASE_ERROR:-0}"
LOG_DIR="${LOG_DIR:-.ralph/logs}"
RUN_ID="${RUN_ID:-overnight-$(date +%Y%m%d-%H%M%S)}"
LOG_FILE="$LOG_DIR/$RUN_ID.log"
PHASE_RUNNER="${PHASE_RUNNER:-scripts/run_phase_tasks.sh}"

usage() {
  cat <<'EOF'
Usage:
  scripts/overnight_ralph.sh [start-phase] [end-phase]

Examples:
  scripts/overnight_ralph.sh
  scripts/overnight_ralph.sh 1 3
  LIST_ONLY=1 scripts/overnight_ralph.sh 1 2
  CONTINUE_ON_PHASE_ERROR=1 scripts/overnight_ralph.sh 1 4

Environment overrides:
  TASKS_FILE                Path to TASKS.md (default: .ralph/feature/current/TASKS.md)
  LIST_ONLY                 1 = print phase/task selections only
  CONTINUE_ON_PHASE_ERROR   1 = continue to next phase if one phase fails
  LOG_DIR                   Directory for run log (default: .ralph/logs)
  RUN_ID                    Custom run id used in log filename
  PHASE_RUNNER              Phase runner script (default: scripts/run_phase_tasks.sh)

Pass-through env for per-task execution:
  ENGINE_FLAG, NO_COMMIT_FLAG, RALPHY_MAX_RETRIES, RALPHY_RETRY_DELAY, CONTINUE_ON_ERROR
  ATOMICITY_MODE, ATOMICITY_ENFORCEMENT, ATOMICITY_CHECKER
EOF
}

if [[ "${START_PHASE:-}" == "-h" ]] || [[ "${START_PHASE:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$TASKS_FILE" ]]; then
  echo "ERROR: tasks file not found: $TASKS_FILE" >&2
  exit 1
fi

if [[ ! -x "$PHASE_RUNNER" ]]; then
  echo "ERROR: phase runner is not executable: $PHASE_RUNNER" >&2
  exit 1
fi

mapfile -t all_phases < <(
  awk '
    /^## Phase [0-9]+/ {
      if (match($0, /^## Phase ([0-9]+)/, m)) print m[1]
    }
  ' "$TASKS_FILE"
)

if [[ "${#all_phases[@]}" -eq 0 ]]; then
  # Fallback for loop-style TASKS.md without phase headers.
  all_phases=(1)
fi

if [[ -z "$START_PHASE" ]]; then
  START_PHASE="${all_phases[0]}"
fi

if [[ -z "$END_PHASE" ]]; then
  END_PHASE="${all_phases[${#all_phases[@]}-1]}"
fi

if [[ ! "$START_PHASE" =~ ^[0-9]+$ ]] || [[ ! "$END_PHASE" =~ ^[0-9]+$ ]]; then
  echo "ERROR: start/end phase must be numeric (got '$START_PHASE' '$END_PHASE')" >&2
  exit 1
fi

if (( START_PHASE > END_PHASE )); then
  echo "ERROR: start-phase must be <= end-phase (got $START_PHASE > $END_PHASE)" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

selected_phases=()
for phase in "${all_phases[@]}"; do
  if (( phase >= START_PHASE && phase <= END_PHASE )); then
    selected_phases+=("$phase")
  fi
done

if [[ "${#selected_phases[@]}" -eq 0 ]]; then
  echo "ERROR: no phases in range $START_PHASE..$END_PHASE within $TASKS_FILE" >&2
  exit 1
fi

log "Overnight Ralph run started: run_id=$RUN_ID"
log "Tasks file: $TASKS_FILE"
log "Phases: ${selected_phases[*]}"
log "Phase runner: $PHASE_RUNNER"
log "List only: $LIST_ONLY"
log "Continue on phase error: $CONTINUE_ON_PHASE_ERROR"

failed_phases=()

for phase in "${selected_phases[@]}"; do
  log "Phase $phase start"
  set +e
  TASKS_FILE="$TASKS_FILE" LIST_ONLY="$LIST_ONLY" "$PHASE_RUNNER" "$phase" 2>&1 | tee -a "$LOG_FILE"
  rc=${PIPESTATUS[0]}
  set -e

  if [[ "$rc" -ne 0 ]]; then
    log "Phase $phase failed (exit $rc)"
    failed_phases+=("$phase")
    if [[ "$CONTINUE_ON_PHASE_ERROR" != "1" ]]; then
      log "Stopping on first phase failure (CONTINUE_ON_PHASE_ERROR=0)"
      break
    fi
    continue
  fi

  log "Phase $phase complete"
done

if [[ "${#failed_phases[@]}" -gt 0 ]]; then
  log "Run completed with phase failures: ${failed_phases[*]}"
  log "Log file: $LOG_FILE"
  exit 1
fi

log "Run completed successfully"
log "Log file: $LOG_FILE"
