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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RALPH_DIR="${RALPH_DIR:-.ralph}"
PLANS_DIR="$RALPH_DIR/plans"
STATE_FILE="$RALPH_DIR/state.json"
LEGACY_CURRENT_DIR="$RALPH_DIR/feature/current"
RUN_PHASE_TASKS="scripts/run_phase_tasks.sh"
RUN_OVERNIGHT="scripts/overnight_ralph.sh"

RUN_STYLE="overnight" # step|overnight
PLAN_OVERRIDE=""
PLAN_ID_OVERRIDE=""
START_PHASE=""
END_PHASE=""
LIST_ONLY="${LIST_ONLY:-0}"
NO_PROMOTE="${NO_PROMOTE:-0}"
AUTO_PROMOTE_OVERRIDE="${AUTO_PROMOTE_OVERRIDE:-}" # true|false|""
FOLLOW_PROMOTIONS="${FOLLOW_PROMOTIONS:-0}"
MAX_PROMOTION_HOPS="${MAX_PROMOTION_HOPS:-20}"
AUTO_ASSIGN_METADATA="${AUTO_ASSIGN_METADATA:-1}"
TASK_METADATA_ASSIGNER="${TASK_METADATA_ASSIGNER:-scripts/assign_task_metadata.sh}"
AUTO_PROMOTED_TO=""

usage() {
  cat <<'USAGE'
Usage:
  oralph [--plan phase|loop] [--run step|overnight] [--plan-id <id>] [--start-phase N] [--end-phase N] [--list] [--auto-promote|--no-auto-promote] [--follow-promotions]
  oralph [start-phase] [end-phase]   # compatibility shorthand

Modes:
  --plan phase|loop    Plan shape for this execution (default: plan.yaml)
  --run step|overnight Run one task at a time or full range
  --auto-promote       Force auto-promotion on for this run
  --no-auto-promote    Force auto-promotion off for this run
  --follow-promotions  Keep executing newly promoted plans in the same run

Behavior:
  - Executes active plan from .ralph/state.json
  - Plan packs live in .ralph/plans/<plan-id>/
  - Auto-assigns task metadata (`engine/model/effort`) by default when missing
  - Auto-promotes to next_plan when completion criteria are met
USAGE
}

json_read_active_plan() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r '.active_plan // empty' "$STATE_FILE"
  else
    sed -n 's/.*"active_plan"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1
  fi
}

json_write_state() {
  local plan_id="$1"
  mkdir -p "$RALPH_DIR"
  cat > "$STATE_FILE" <<JSON
{
  "active_plan": "$plan_id",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

yaml_get() {
  local key="$1"
  local file="$2"
  awk -F':[[:space:]]*' -v k="$key" '
    $0 ~ "^[[:space:]]*#" { next }
    $1 == k {
      v = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      gsub(/^"|"$/, "", v)
      print v
      exit
    }
  ' "$file"
}

sync_legacy_current() {
  local plan_dir="$1"
  mkdir -p "$LEGACY_CURRENT_DIR"
  local file
  for file in ASSUMPTIONS.md ARCHITECTURE.md SPEC.md TASKS.md STORIES.md TESTS.md SHIP.md REVIEW.md RETRO.md STANDARDS.md; do
    if [[ -f "$plan_dir/$file" ]]; then
      cp "$plan_dir/$file" "$LEGACY_CURRENT_DIR/$file"
    fi
  done
}

bootstrap_current_plan() {
  mkdir -p "$PLANS_DIR"
  local plan_id="current"
  local plan_dir="$PLANS_DIR/$plan_id"

  if [[ -d "$plan_dir" ]]; then
    return 0
  fi

  mkdir -p "$plan_dir"
  local file
  for file in ASSUMPTIONS.md ARCHITECTURE.md SPEC.md TASKS.md STORIES.md TESTS.md SHIP.md REVIEW.md RETRO.md STANDARDS.md; do
    if [[ -f "$LEGACY_CURRENT_DIR/$file" ]]; then
      cp "$LEGACY_CURRENT_DIR/$file" "$plan_dir/$file"
    elif [[ "$file" == "TASKS.md" && -f "$ROOT_DIR/TASKS.md" ]]; then
      cp "$ROOT_DIR/TASKS.md" "$plan_dir/$file"
    elif [[ "$file" == "SPEC.md" && -f "$ROOT_DIR/SPEC.md" ]]; then
      cp "$ROOT_DIR/SPEC.md" "$plan_dir/$file"
    elif [[ "$file" == "STANDARDS.md" && -f "$ROOT_DIR/STANDARDS.md" ]]; then
      cp "$ROOT_DIR/STANDARDS.md" "$plan_dir/$file"
    fi
  done

  if [[ ! -f "$plan_dir/TASKS.md" ]]; then
    echo "# Tasks" > "$plan_dir/TASKS.md"
  fi

  cat > "$plan_dir/plan.yaml" <<YAML
plan_id: current
plan_shape: loop
completion: all_tasks_checked
auto_promote: false
next_plan:
YAML
}

count_unchecked_tasks() {
  local tasks_file="$1"
  awk '/^- \[ \]/ { c++ } END { print c + 0 }' "$tasks_file"
}

first_unfinished_phase() {
  local tasks_file="$1"
  awk '
    BEGIN { current=1; has_headers=0 }
    /^## Phase [0-9]+/ {
      has_headers=1
      if (match($0, /^## Phase ([0-9]+)/, m)) current=m[1]+0
      next
    }
    /^- \[ \] / {
      if (!(current in seen)) {
        seen[current]=1
        order[++n]=current
      }
    }
    END {
      if (n > 0) {
        print order[1]
      } else if (!has_headers) {
        print 1
      }
    }
  ' "$tasks_file"
}

run_plan() {
  local plan_dir="$1"
  local effective_shape="$2"
  local tasks_file="$plan_dir/TASKS.md"

  if [[ ! -f "$tasks_file" ]]; then
    echo "ERROR: missing tasks file in plan: $tasks_file" >&2
    exit 1
  fi

  if [[ "$AUTO_ASSIGN_METADATA" == "1" && "$LIST_ONLY" != "1" ]]; then
    if [[ -x "$TASK_METADATA_ASSIGNER" ]]; then
      TASKS_FILE="$tasks_file" "$TASK_METADATA_ASSIGNER" || \
        echo "WARN: task metadata assignment failed; continuing with existing tasks."
    else
      echo "WARN: metadata assigner not executable: $TASK_METADATA_ASSIGNER"
    fi
  fi

  sync_legacy_current "$plan_dir"

  if [[ "$RUN_STYLE" == "step" ]]; then
    local target_phase=""
    if [[ -n "$START_PHASE" ]]; then
      target_phase="$START_PHASE"
    elif [[ "$effective_shape" == "loop" ]]; then
      target_phase="1"
    else
      target_phase="$(first_unfinished_phase "$tasks_file")"
    fi

    if [[ -z "$target_phase" ]]; then
      echo "No unfinished tasks found for active plan."
      return 0
    fi

    TASKS_FILE="$tasks_file" LIST_ONLY="$LIST_ONLY" MAX_TASKS=1 "$RUN_PHASE_TASKS" "$target_phase"
  else
    local start="$START_PHASE"
    local end="$END_PHASE"
    if [[ "$effective_shape" == "loop" ]]; then
      start="${start:-1}"
      end="${end:-1}"
    fi
    TASKS_FILE="$tasks_file" LIST_ONLY="$LIST_ONLY" "$RUN_OVERNIGHT" "$start" "$end"
  fi
}

auto_promote_if_ready() {
  local plan_id="$1"
  local plan_dir="$2"
  local plan_yaml="$3"
  local tasks_file="$plan_dir/TASKS.md"

  if [[ "$LIST_ONLY" == "1" ]]; then
    return 0
  fi
  AUTO_PROMOTED_TO=""

  local completion="$(yaml_get completion "$plan_yaml")"
  completion="${completion:-all_tasks_checked}"

  if [[ "$completion" != "all_tasks_checked" ]]; then
    echo "Skipping auto-promotion: unsupported completion mode '$completion'"
    return 0
  fi

  local unchecked
  unchecked="$(count_unchecked_tasks "$tasks_file")"
  if [[ "$unchecked" != "0" ]]; then
    echo "Plan '$plan_id' still has $unchecked unchecked task(s); no promotion."
    return 0
  fi

  local auto_promote
  auto_promote="$(yaml_get auto_promote "$plan_yaml")"
  if [[ "$NO_PROMOTE" == "1" ]]; then
    auto_promote="false"
  fi
  if [[ -n "$AUTO_PROMOTE_OVERRIDE" ]]; then
    auto_promote="$AUTO_PROMOTE_OVERRIDE"
  fi
  case "$auto_promote" in
    true|1|yes) ;;
    *)
      echo "Plan '$plan_id' is complete. auto_promote is disabled."
      return 0
      ;;
  esac

  local next_plan
  next_plan="$(yaml_get next_plan "$plan_yaml")"
  if [[ -z "$next_plan" ]]; then
    echo "Plan '$plan_id' is complete, but next_plan is not set."
    return 0
  fi

  local next_dir="$PLANS_DIR/$next_plan"
  if [[ ! -d "$next_dir" ]]; then
    echo "ERROR: auto-promotion target missing: $next_dir" >&2
    echo "Action: create the plan pack, then rerun oralph or run: opipeline repair" >&2
    exit 1
  fi

  json_write_state "$next_plan"
  sync_legacy_current "$next_dir"
  AUTO_PROMOTED_TO="$next_plan"
  echo "Auto-promoted active plan: $plan_id -> $next_plan"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan)
      [[ $# -ge 2 ]] || { echo "ERROR: --plan requires value" >&2; exit 1; }
      PLAN_OVERRIDE="$2"
      shift 2
      ;;
    --run)
      [[ $# -ge 2 ]] || { echo "ERROR: --run requires value" >&2; exit 1; }
      RUN_STYLE="$2"
      shift 2
      ;;
    --plan-id)
      [[ $# -ge 2 ]] || { echo "ERROR: --plan-id requires value" >&2; exit 1; }
      PLAN_ID_OVERRIDE="$2"
      shift 2
      ;;
    --start-phase)
      [[ $# -ge 2 ]] || { echo "ERROR: --start-phase requires value" >&2; exit 1; }
      START_PHASE="$2"
      shift 2
      ;;
    --end-phase)
      [[ $# -ge 2 ]] || { echo "ERROR: --end-phase requires value" >&2; exit 1; }
      END_PHASE="$2"
      shift 2
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    --no-promote)
      NO_PROMOTE=1
      AUTO_PROMOTE_OVERRIDE="false"
      shift
      ;;
    --auto-promote)
      NO_PROMOTE=0
      AUTO_PROMOTE_OVERRIDE="true"
      shift
      ;;
    --no-auto-promote)
      NO_PROMOTE=1
      AUTO_PROMOTE_OVERRIDE="false"
      shift
      ;;
    --follow-promotions)
      FOLLOW_PROMOTIONS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$START_PHASE" && "$1" =~ ^[0-9]+$ ]]; then
        START_PHASE="$1"
        shift
      elif [[ -z "$END_PHASE" && "$1" =~ ^[0-9]+$ ]]; then
        END_PHASE="$1"
        shift
      else
        echo "ERROR: unknown argument '$1'" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

case "$RUN_STYLE" in
  step|overnight) ;;
  *) echo "ERROR: --run must be step or overnight" >&2; exit 1 ;;
esac

bootstrap_current_plan

active_plan="$(json_read_active_plan)"
active_plan="${active_plan:-current}"

if [[ -n "$PLAN_ID_OVERRIDE" ]]; then
  active_plan="$PLAN_ID_OVERRIDE"
fi

promotion_hops=0

while :; do
  plan_dir="$PLANS_DIR/$active_plan"
  if [[ ! -d "$plan_dir" ]]; then
    echo "ERROR: active plan pack missing: $plan_dir" >&2
    echo "Action: run 'opipeline repair' or set a valid plan with --plan-id" >&2
    exit 1
  fi

  plan_yaml="$plan_dir/plan.yaml"
  if [[ ! -f "$plan_yaml" ]]; then
    cat > "$plan_yaml" <<YAML
plan_id: $active_plan
plan_shape: loop
completion: all_tasks_checked
auto_promote: false
next_plan:
YAML
  fi

  manifest_shape="$(yaml_get plan_shape "$plan_yaml")"
  manifest_shape="${manifest_shape:-loop}"

  case "$manifest_shape" in
    phase|loop) ;;
    *) echo "ERROR: invalid plan_shape in $plan_yaml: $manifest_shape" >&2; exit 1 ;;
  esac

  effective_shape="$manifest_shape"
  if [[ -n "$PLAN_OVERRIDE" ]]; then
    case "$PLAN_OVERRIDE" in
      phase|loop) effective_shape="$PLAN_OVERRIDE" ;;
      *) echo "ERROR: --plan must be phase or loop" >&2; exit 1 ;;
    esac
  fi

  echo "Active plan: $active_plan"
  echo "Plan shape: $effective_shape"
  echo "Run style: $RUN_STYLE"

  run_plan "$plan_dir" "$effective_shape"
  # Keep legacy view in sync with mutations (task checkoffs) done in plan pack.
  sync_legacy_current "$plan_dir"
  json_write_state "$active_plan"
  auto_promote_if_ready "$active_plan" "$plan_dir" "$plan_yaml"

  if [[ "$FOLLOW_PROMOTIONS" == "1" && -n "$AUTO_PROMOTED_TO" ]]; then
    promotion_hops=$((promotion_hops + 1))
    if (( promotion_hops > MAX_PROMOTION_HOPS )); then
      echo "ERROR: exceeded MAX_PROMOTION_HOPS=$MAX_PROMOTION_HOPS while following promotions." >&2
      exit 1
    fi
    active_plan="$AUTO_PROMOTED_TO"
    # Do not carry explicit phase bounds into subsequent promoted plans.
    START_PHASE=""
    END_PHASE=""
    echo "Following promoted plan: $active_plan"
    continue
  fi

  break
done
