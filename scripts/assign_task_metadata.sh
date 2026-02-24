#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi

TASKS_FILE="${TASKS_FILE:-.ralph/plans/current/TASKS.md}"
ENGINE_DEFAULT="${ENGINE_DEFAULT:---codex}"
MODEL_DEFAULT="${MODEL_DEFAULT:-gpt-5.3-codex}"
EFFORT_DEFAULT="${EFFORT_DEFAULT:-medium}"
NO_COMMIT_FLAG="${NO_COMMIT_FLAG:---no-commit}"
ASSIGN_TIMEOUT_SEC="${ASSIGN_TIMEOUT_SEC:-300}"

engine_flag_to_tag() {
  case "$1" in
    ""|codex|--codex) echo "codex" ;;
    claude|--claude) echo "claude" ;;
    opencode|--opencode) echo "opencode" ;;
    cursor|--cursor) echo "cursor" ;;
    qwen|--qwen) echo "qwen" ;;
    droid|--droid) echo "droid" ;;
    copilot|--copilot) echo "copilot" ;;
    gemini|--gemini) echo "gemini" ;;
    *) echo "codex" ;;
  esac
}

ENGINE_TAG_DEFAULT="${ENGINE_TAG_DEFAULT:-$(engine_flag_to_tag "$ENGINE_DEFAULT")}"

if [[ ! -f "$TASKS_FILE" ]]; then
  echo "WARN: metadata assigner tasks file missing: $TASKS_FILE" >&2
  exit 0
fi

missing_count() {
  awk '
    /^- \[ \] / {
      if ($0 !~ /^- \[ \] \[[^]]*engine=[^]]*model=[^]]*effort=[^]]*\][[:space:]]+/) c++
    }
    END { print c + 0 }
  ' "$TASKS_FILE"
}

add_default_metadata() {
  ENGINE_TAG="$ENGINE_TAG_DEFAULT" MODEL="$MODEL_DEFAULT" EFFORT="$EFFORT_DEFAULT" perl -i -pe '
    if (/^- \[ \] / && !/^- \[ \] \[[^]]*engine=[^]]*model=[^]]*effort=[^]]*\][[:space:]]+/) {
      s/^- \[ \] /- [ ] [engine=$ENV{ENGINE_TAG} model=$ENV{MODEL} effort=$ENV{EFFORT}] /;
    }
  ' "$TASKS_FILE"
}

before_missing="$(missing_count)"
if [[ "$before_missing" == "0" ]]; then
  exit 0
fi

if ! command -v ralphy >/dev/null 2>&1; then
  echo "WARN: ralphy not found; applying default metadata tags." >&2
  add_default_metadata
  exit 0
fi

prompt="Edit $TASKS_FILE only. For each unchecked task line that lacks metadata, prepend exactly one metadata block.

Format: [engine=<engine> model=<model> effort=low|medium|high]

Engine routing — pick the best fit per task:
  claude   model=claude-sonnet-4-6  — complex reasoning, multi-file changes, architecture decisions, ambiguous requirements, code review, writing nuanced tests
  claude   model=claude-opus-4-6    — deep architecture or design tasks requiring sustained reasoning across many constraints
  codex    model=gpt-5.3-codex      — straightforward implementation, boilerplate, well-scoped single-file changes, adding tests that follow an existing pattern
  gemini   model=gemini-2.5-flash   — research, documentation, broad knowledge lookups with no file edits
  When uncertain, default to: engine=$ENGINE_TAG_DEFAULT model=$MODEL_DEFAULT

Effort:
  low    < 30 min, single file, simple change
  medium   1–2 h, 2–4 files, moderate complexity
  high   > 2 h, many files, or high uncertainty

Rules: do NOT modify checked tasks. Do NOT change task wording. Add ONLY the metadata prefix."

set +e
if command -v timeout >/dev/null 2>&1; then
  ralphy_cmd=(timeout "$ASSIGN_TIMEOUT_SEC" ralphy "$prompt" "$ENGINE_DEFAULT" --max-retries 1 --retry-delay 5 "$NO_COMMIT_FLAG")
else
  ralphy_cmd=(ralphy "$prompt" "$ENGINE_DEFAULT" --max-retries 1 --retry-delay 5 "$NO_COMMIT_FLAG")
fi
"${ralphy_cmd[@]}" >/tmp/assign_task_metadata.out 2>&1
rc=$?
set -e

after_missing="$(missing_count)"
if [[ "$rc" -ne 0 ]] || [[ "$after_missing" != "0" ]]; then
  echo "WARN: LLM metadata assignment incomplete; filling remaining tasks with defaults." >&2
  add_default_metadata
fi

final_missing="$(missing_count)"
if [[ "$final_missing" != "0" ]]; then
  echo "WARN: metadata assignment still incomplete for $final_missing task(s)." >&2
else
  echo "Metadata assignment complete for $TASKS_FILE"
fi
