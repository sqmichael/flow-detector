#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RALPH_DIR="${RALPH_DIR:-.ralph}"
PLANS_DIR="$RALPH_DIR/plans"
STATE_FILE="$RALPH_DIR/state.json"
LEGACY_CURRENT_DIR="$RALPH_DIR/feature/current"

usage() {
  cat <<'USAGE'
Usage:
  opipeline <command> [args]

Commands:
  validate            Check state and plan-pack integrity
  promote [plan-id]   Promote to explicit plan-id or active plan's next_plan
  repair              Bootstrap plans/state from legacy current folder
  status              Print active plan and next promotion target
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
  local plan_dir="$PLANS_DIR/current"
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

  [[ -f "$plan_dir/TASKS.md" ]] || echo "# Tasks" > "$plan_dir/TASKS.md"

  cat > "$plan_dir/plan.yaml" <<YAML
plan_id: current
plan_shape: loop
completion: all_tasks_checked
auto_promote: false
next_plan:
YAML
}

validate() {
  bootstrap_current_plan

  local active
  active="$(json_read_active_plan)"
  active="${active:-current}"

  if [[ ! -d "$PLANS_DIR/$active" ]]; then
    echo "ERROR: active plan does not exist: $active" >&2
    return 1
  fi

  local missing=0
  local plan
  for plan in "$PLANS_DIR"/*; do
    [[ -d "$plan" ]] || continue
    if [[ ! -f "$plan/TASKS.md" ]]; then
      echo "ERROR: missing $plan/TASKS.md" >&2
      missing=1
    fi
    if [[ ! -f "$plan/plan.yaml" ]]; then
      echo "ERROR: missing $plan/plan.yaml" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi

  echo "validate: OK"
  echo "active_plan: $active"
}

promote() {
  bootstrap_current_plan

  local target="${1:-}"
  local active
  active="$(json_read_active_plan)"
  active="${active:-current}"

  local active_yaml="$PLANS_DIR/$active/plan.yaml"
  if [[ -z "$target" ]]; then
    if [[ ! -f "$active_yaml" ]]; then
      echo "ERROR: missing active plan manifest: $active_yaml" >&2
      return 1
    fi
    target="$(yaml_get next_plan "$active_yaml")"
  fi

  if [[ -z "$target" ]]; then
    echo "ERROR: no target plan specified and active plan has no next_plan" >&2
    return 1
  fi

  if [[ ! -d "$PLANS_DIR/$target" ]]; then
    echo "ERROR: target plan does not exist: $PLANS_DIR/$target" >&2
    return 1
  fi

  json_write_state "$target"
  sync_legacy_current "$PLANS_DIR/$target"
  echo "promoted: $active -> $target"
}

repair() {
  bootstrap_current_plan

  local active
  active="$(json_read_active_plan)"
  active="${active:-current}"

  if [[ ! -d "$PLANS_DIR/$active" ]]; then
    active="current"
  fi

  json_write_state "$active"
  sync_legacy_current "$PLANS_DIR/$active"
  echo "repair: active_plan=$active"
}

status() {
  bootstrap_current_plan

  local active
  active="$(json_read_active_plan)"
  active="${active:-current}"
  local yaml="$PLANS_DIR/$active/plan.yaml"
  local next=""
  local shape=""

  if [[ -f "$yaml" ]]; then
    next="$(yaml_get next_plan "$yaml")"
    shape="$(yaml_get plan_shape "$yaml")"
  fi

  echo "active_plan: $active"
  echo "plan_shape: ${shape:-loop}"
  echo "next_plan: ${next:-<none>}"
}

cmd="${1:-}"
case "$cmd" in
  validate)
    shift
    validate "$@"
    ;;
  promote)
    shift
    promote "$@"
    ;;
  repair)
    shift
    repair "$@"
    ;;
  status)
    shift
    status "$@"
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    echo "ERROR: unknown command '$cmd'" >&2
    usage
    exit 1
    ;;
esac
