#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi

if [[ -f "$HOME/.bashrc" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "$HOME/.bashrc"
  set -u
fi

CURRENT_DIR="${CURRENT_DIR:-.ralph/feature/current}"
QUEUED_DIR="${QUEUED_DIR:-.ralph/feature/queued/p0-phase-3-audit}"
PHASE2_TASKS_FILE="${PHASE2_TASKS_FILE:-$CURRENT_DIR/TASKS.md}"
PHASE3_TASKS_FILE="${PHASE3_TASKS_FILE:-$QUEUED_DIR/TASKS.md}"
PHASE2_START="${PHASE2_START:-1}"
PHASE2_END="${PHASE2_END:-6}"
PHASE3_START="${PHASE3_START:-1}"
PHASE3_END="${PHASE3_END:-}"
SKIP_PHASE2_RUN="${SKIP_PHASE2_RUN:-0}"
DRY_RUN="${DRY_RUN:-0}"
FORCE_REPLACE="${FORCE_REPLACE:-0}"
SYNC_QUEUE_AFTER_PROMOTION="${SYNC_QUEUE_AFTER_PROMOTION:-1}"
LOG_DIR="${LOG_DIR:-.ralph/logs}"
RUN_ID="${RUN_ID:-pipeline-$(date +%Y%m%d-%H%M%S)}"
LOG_FILE="$LOG_DIR/$RUN_ID.log"
RUNNER="${RUNNER:-scripts/overnight_ralph.sh}"
ARCHIVE_DIR="${ARCHIVE_DIR:-.ralph/feature/archive/$RUN_ID-before-phase3-promotion}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/run_phase_pipeline.sh

Default behavior:
  1) Runs Phase 2 from current TASKS.md (Phase 1..6 by default)
  2) Verifies selected Phase 2 range has no unchecked tasks
  3) Archives current planning artifacts
  4) Promotes queued Phase 3 artifacts into .ralph/feature/current/
  5) Runs Phase 3 from promoted TASKS.md

Environment overrides:
  CURRENT_DIR        Default: .ralph/feature/current
  QUEUED_DIR         Default: .ralph/feature/queued/p0-phase-3-audit
  PHASE2_TASKS_FILE  Default: $CURRENT_DIR/TASKS.md
  PHASE3_TASKS_FILE  Default: $QUEUED_DIR/TASKS.md
  PHASE2_START       Default: 1
  PHASE2_END         Default: 6
  PHASE3_START       Default: 1
  PHASE3_END         Default: last phase in PHASE3_TASKS_FILE
  SKIP_PHASE2_RUN    1 = skip running Phase 2, only verify + promote + run Phase 3
  DRY_RUN            1 = print actions only, do not execute
  FORCE_REPLACE      1 = promote queued artifacts even if Phase 2 has unchecked tasks
  SYNC_QUEUE_AFTER_PROMOTION
                     1 = copy current artifacts back to queued after successful Phase 3 run
  LOG_DIR            Default: .ralph/logs
  RUN_ID             Custom run id for logs/archive path
  RUNNER             Default: scripts/overnight_ralph.sh
  ARCHIVE_DIR        Default: .ralph/feature/archive/<run>-before-phase3-promotion

Pass-through env to runner:
  LIST_ONLY CONTINUE_ON_PHASE_ERROR ENGINE_FLAG NO_COMMIT_FLAG
  RALPHY_MAX_RETRIES RALPHY_RETRY_DELAY CONTINUE_ON_ERROR
  ATOMICITY_MODE ATOMICITY_ENFORCEMENT ATOMICITY_CHECKER
USAGE
}

if [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_file() {
  local file="$1"
  [[ -f "$file" ]] || fail "missing required file: $file"
}

phase_last() {
  local tasks_file="$1"
  awk '
    /^## Phase [0-9]+/ {
      if (match($0, /^## Phase ([0-9]+)/, m)) last=m[1]
    }
    END {
      if (last == "") {
        print 1
        exit 0
      }
      print last
    }
  ' "$tasks_file"
}

count_unchecked_in_range() {
  local tasks_file="$1"
  local start_phase="$2"
  local end_phase="$3"
  local has_headers=0
  if awk '/^## Phase [0-9]+/ { found=1; exit } END { exit found ? 0 : 1 }' "$tasks_file"; then
    has_headers=1
  fi

  if [[ "$has_headers" -eq 0 ]]; then
    if (( start_phase <= 1 && end_phase >= 1 )); then
      awk '/^- \[ \]/ { count++ } END { print count + 0 }' "$tasks_file"
    else
      echo "0"
    fi
    return
  fi

  awk -v start="$start_phase" -v end="$end_phase" '
    /^## Phase [0-9]+/ {
      if (match($0, /^## Phase ([0-9]+)/, m)) current=m[1]+0
      in_scope = (current >= start && current <= end)
      next
    }
    in_scope && /^- \[ \]/ { count++ }
    END { print count + 0 }
  ' "$tasks_file"
}

copy_artifact_set() {
  local from_dir="$1"
  local to_dir="$2"
  local file
  for file in ASSUMPTIONS.md ARCHITECTURE.md SPEC.md TASKS.md; do
    require_file "$from_dir/$file"
  done

  mkdir -p "$to_dir"
  cp "$from_dir/ASSUMPTIONS.md" "$to_dir/ASSUMPTIONS.md"
  cp "$from_dir/ARCHITECTURE.md" "$to_dir/ARCHITECTURE.md"
  cp "$from_dir/SPEC.md" "$to_dir/SPEC.md"
  cp "$from_dir/TASKS.md" "$to_dir/TASKS.md"
}

log "Pipeline start: run_id=$RUN_ID"
log "Current dir: $CURRENT_DIR"
log "Queued dir: $QUEUED_DIR"
log "Phase2 range: $PHASE2_START..$PHASE2_END"

require_file "$PHASE2_TASKS_FILE"
require_file "$PHASE3_TASKS_FILE"
[[ -x "$RUNNER" ]] || fail "runner is not executable: $RUNNER"

if [[ -z "$PHASE3_END" ]]; then
  PHASE3_END="$(phase_last "$PHASE3_TASKS_FILE")" || fail "no phase headers found in $PHASE3_TASKS_FILE"
fi

log "Phase3 range: $PHASE3_START..$PHASE3_END"

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY_RUN=1, no commands will be executed"
fi

if [[ "$SKIP_PHASE2_RUN" != "1" ]]; then
  log "Running Phase 2 via $RUNNER"
  if [[ "$DRY_RUN" != "1" ]]; then
    set +e
    TASKS_FILE="$PHASE2_TASKS_FILE" "$RUNNER" "$PHASE2_START" "$PHASE2_END" 2>&1 | tee -a "$LOG_FILE"
    rc=${PIPESTATUS[0]}
    set -e
    [[ "$rc" -eq 0 ]] || fail "Phase 2 run failed with exit $rc"
  fi
else
  log "Skipping Phase 2 run (SKIP_PHASE2_RUN=1)"
fi

unchecked_phase2="$(count_unchecked_in_range "$PHASE2_TASKS_FILE" "$PHASE2_START" "$PHASE2_END")"
if [[ "$unchecked_phase2" -ne 0 ]] && [[ "$FORCE_REPLACE" != "1" ]]; then
  log "Phase 2 has $unchecked_phase2 unchecked task(s) in range $PHASE2_START..$PHASE2_END"
  log "Policy decision: KEEP NEXT PLAN QUEUED (no promotion while active tasks remain)"
  log "To override intentionally, rerun with FORCE_REPLACE=1"
  log "Pipeline finished without promotion"
  log "Log file: $LOG_FILE"
  exit 0
fi
if [[ "$unchecked_phase2" -ne 0 ]] && [[ "$FORCE_REPLACE" == "1" ]]; then
  log "FORCE_REPLACE=1 set: promoting queued artifacts despite $unchecked_phase2 unchecked task(s)"
else
  log "Phase 2 verification passed: no unchecked tasks in selected range"
fi

log "Archiving current planning artifacts to $ARCHIVE_DIR"
if [[ "$DRY_RUN" != "1" ]]; then
  mkdir -p "$ARCHIVE_DIR"
  copy_artifact_set "$CURRENT_DIR" "$ARCHIVE_DIR"
fi

log "Promoting queued Phase 3 artifacts into $CURRENT_DIR"
if [[ "$DRY_RUN" != "1" ]]; then
  copy_artifact_set "$QUEUED_DIR" "$CURRENT_DIR"
fi

log "Running Phase 3 via $RUNNER"
if [[ "$DRY_RUN" != "1" ]]; then
  set +e
  TASKS_FILE="$CURRENT_DIR/TASKS.md" "$RUNNER" "$PHASE3_START" "$PHASE3_END" 2>&1 | tee -a "$LOG_FILE"
  rc=${PIPESTATUS[0]}
  set -e
  [[ "$rc" -eq 0 ]] || fail "Phase 3 run failed with exit $rc"
fi

if [[ "$SYNC_QUEUE_AFTER_PROMOTION" == "1" ]]; then
  log "Syncing current artifacts back to queued directory"
  if [[ "$DRY_RUN" != "1" ]]; then
    copy_artifact_set "$CURRENT_DIR" "$QUEUED_DIR"
  fi
fi

log "Pipeline completed successfully"
log "Log file: $LOG_FILE"
