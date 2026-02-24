#!/usr/bin/env bash
set -euo pipefail

HOME_AGENTS="${1:-/home/michael/AGENTS.md}"
ROOT_DIR="${2:-/home/michael}"
MAXDEPTH="${MAXDEPTH:-3}"

BEGIN_MARKER="<!-- BEGIN HOME RESPONSE PROTOCOL -->"
END_MARKER="<!-- END HOME RESPONSE PROTOCOL -->"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ ! -f "$HOME_AGENTS" ]]; then
  echo "error: source AGENTS not found: $HOME_AGENTS" >&2
  exit 1
fi

SECTION_FILE="$TMP_DIR/section.md"
awk '
  /^## Response Protocol \(lightweight\)/ { in_section=1 }
  /^## Task Classification/ && in_section { exit }
  in_section { print }
' "$HOME_AGENTS" > "$SECTION_FILE"

if ! rg -q '^## Response Protocol \(lightweight\)' "$SECTION_FILE"; then
  echo "error: could not extract Response Protocol section from $HOME_AGENTS" >&2
  exit 1
fi

MANAGED_BLOCK="$TMP_DIR/managed_block.md"
{
  printf "%s\n\n" "$BEGIN_MARKER"
  cat "$SECTION_FILE"
  printf "\n%s\n" "$END_MARKER"
} > "$MANAGED_BLOCK"

sync_repo_agents() {
  local repo="$1"
  local target="$repo/AGENTS.md"
  local temp="$TMP_DIR/agents.tmp"

  if [[ ! -f "$target" ]]; then
    {
      printf "# AGENTS.md\n\n"
      printf "Last updated: %s\n\n" "$(date +%F)"
      cat "$MANAGED_BLOCK"
      printf "\n"
    } > "$target"
    echo "created $target"
    return
  fi

  if rg -qF "$BEGIN_MARKER" "$target"; then
    awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
      $0 == begin { print begin; skipping=1; next }
      $0 == end && skipping { skipping=0; next }
      !skipping { print }
    ' "$target" > "$temp"

    awk -v begin="$BEGIN_MARKER" '
      { print }
      $0 == begin {
        while ((getline line < "'"$SECTION_FILE"'") > 0) print line
        print "'"$END_MARKER"'"
      }
    ' "$temp" > "$target"
    echo "updated $target (managed block)"
    return
  fi

  {
    cat "$target"
    printf "\n%s\n" "$BEGIN_MARKER"
    cat "$SECTION_FILE"
    printf "\n%s\n" "$END_MARKER"
  } > "$temp"
  mv "$temp" "$target"
  echo "updated $target (appended block)"
}

while IFS= read -r git_dir; do
  repo="${git_dir%/.git}"
  sync_repo_agents "$repo"
done < <(find "$ROOT_DIR" -maxdepth "$MAXDEPTH" -type d -name .git | sort)
