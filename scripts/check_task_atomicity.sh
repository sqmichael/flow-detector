#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi

TASKS_FILE="${TASKS_FILE:-.ralph/feature/current/TASKS.md}"
START_PHASE="${1:-}"
END_PHASE="${2:-}"
ATOMICITY_MODE="${ATOMICITY_MODE:-loop}"            # off|phase|loop
ATOMICITY_ENFORCEMENT="${ATOMICITY_ENFORCEMENT:-warn}" # warn|enforce

usage() {
  cat <<'EOF'
Usage:
  scripts/check_task_atomicity.sh [start-phase] [end-phase]

Environment overrides:
  TASKS_FILE              Path to TASKS.md (default: .ralph/feature/current/TASKS.md)
  ATOMICITY_MODE          off|phase|loop (default: loop)
  ATOMICITY_ENFORCEMENT   warn|enforce (default: warn)

Notes:
  - loop  : strict one-loop heuristic checks
  - phase : relaxed checks (still catches obviously oversized tasks)
  - off   : disable checks
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

case "$ATOMICITY_MODE" in
  off|phase|loop) ;;
  *)
    echo "ERROR: unsupported ATOMICITY_MODE='$ATOMICITY_MODE' (expected off|phase|loop)" >&2
    exit 1
    ;;
esac

case "$ATOMICITY_ENFORCEMENT" in
  warn|enforce) ;;
  *)
    echo "ERROR: unsupported ATOMICITY_ENFORCEMENT='$ATOMICITY_ENFORCEMENT' (expected warn|enforce)" >&2
    exit 1
    ;;
esac

if [[ "$ATOMICITY_MODE" == "off" ]]; then
  echo "Atomicity check skipped (ATOMICITY_MODE=off)"
  exit 0
fi

if [[ -z "$START_PHASE" ]]; then
  START_PHASE=1
fi

if [[ -z "$END_PHASE" ]]; then
  END_PHASE=99999
fi

if [[ ! "$START_PHASE" =~ ^[0-9]+$ ]] || [[ ! "$END_PHASE" =~ ^[0-9]+$ ]]; then
  echo "ERROR: start/end phase must be numeric (got '$START_PHASE' '$END_PHASE')" >&2
  exit 1
fi

if (( START_PHASE > END_PHASE )); then
  echo "ERROR: start-phase must be <= end-phase (got $START_PHASE > $END_PHASE)" >&2
  exit 1
fi

max_len=320
max_backticks=4
if [[ "$ATOMICITY_MODE" == "phase" ]]; then
  max_len=500
  max_backticks=8
fi

tmp_report="$(mktemp)"

has_phase_headers=0
if awk '/^## Phase [0-9]+/ { found=1; exit } END { exit found ? 0 : 1 }' "$TASKS_FILE"; then
  has_phase_headers=1
fi

awk -v start="$START_PHASE" -v end="$END_PHASE" -v mode="$ATOMICITY_MODE" -v max_len="$max_len" -v max_backticks="$max_backticks" -v has_headers="$has_phase_headers" '
  function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
  BEGIN {
    current_phase = 1
    in_scope = (has_headers ? 0 : (current_phase >= start && current_phase <= end))
  }
  /^## Phase [0-9]+/ {
    if (match($0, /^## Phase ([0-9]+)/, m)) {
      current_phase = m[1] + 0
      in_scope = (current_phase >= start && current_phase <= end)
    }
    next
  }
  !in_scope { next }
  /^- \[ \] / {
    raw = $0
    sub(/^- \[ \] /, "", raw)
    text = raw
    if (match(text, /^\[[^]]+\][[:space:]]+/)) {
      text = substr(text, RLENGTH + 1)
    }
    text = trim(text)

    n = split(text, parts, /`/)
    backtick_pairs = int(n / 2)
    has_conjunction = (text ~ /(^|[^[:alnum:]_])(and|then|plus|as well as)([^[:alnum:]_]|$)/)
    has_semicolon = (text ~ /;/)
    has_multi_clause = (text ~ /, [a-z]/)
    has_and_or = (text ~ /(^|[^[:alnum:]_])and\/or([^[:alnum:]_]|$)/)
    over_len = (length(text) > max_len)
    over_backticks = (backtick_pairs > max_backticks)

    # Strict loop mode rejects conjunction-heavy tasks. Phase mode only flags extreme tasks.
    fail = 0
    reason = ""
    if (over_len) {
      fail = 1
      reason = reason "too long; "
    }
    if (over_backticks) {
      fail = 1
      reason = reason "too many targets; "
    }
    if (mode == "loop") {
      if (has_conjunction || has_semicolon || has_multi_clause || has_and_or) {
        fail = 1
        reason = reason "multi-action phrasing; "
      }
    } else if (mode == "phase") {
      if (has_semicolon && over_backticks) {
        fail = 1
        reason = reason "overscoped for phase task; "
      }
    }

    if (fail) {
      print NR "\t" current_phase "\t" reason "\t" text
    }
  }
' "$TASKS_FILE" > "$tmp_report"

issue_count="$(wc -l < "$tmp_report" | tr -d ' ')"
if [[ "$issue_count" -eq 0 ]]; then
  echo "Atomicity check passed ($ATOMICITY_MODE mode) for phases $START_PHASE..$END_PHASE"
  rm -f "$tmp_report"
  exit 0
fi

echo "Atomicity check found $issue_count potential issue(s) ($ATOMICITY_MODE mode):"
while IFS=$'\t' read -r line phase reason task; do
  [[ -n "$line" ]] || continue
  echo "  - line $line (phase $phase): $reason"
  echo "    task: $task"
done < "$tmp_report"

rm -f "$tmp_report"

if [[ "$ATOMICITY_ENFORCEMENT" == "enforce" ]]; then
  echo "Atomicity enforcement is enabled; failing run."
  exit 2
fi

echo "Atomicity enforcement is warn-only; continuing."
exit 0
