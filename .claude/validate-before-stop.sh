#!/bin/bash

# Flow Detector - Pre-Stop Validation Script
# This script runs before Claude can finish, ensuring work is complete.

# Use script's location to find project root (more robust than env var)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

errors=()

# 1. Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    errors+=("Uncommitted changes exist. Please commit your work.")
fi

# 2. Check if TypeScript compiles (if tsconfig.json exists)
if [ -f "tsconfig.json" ]; then
    if ! npx tsc --noEmit 2>/dev/null; then
        errors+=("TypeScript compilation failed. Fix type errors before stopping.")
    fi
fi

# 3. Check if build passes (if package.json has build script)
if [ -f "package.json" ]; then
    if grep -q '"build"' package.json; then
        if ! npm run build --silent 2>/dev/null; then
            errors+=("Build failed. Fix build errors before stopping.")
        fi
    fi
fi

# 4. Check if tests pass (if package.json has test script that isn't the default)
if [ -f "package.json" ]; then
    if grep -q '"test"' package.json && ! grep -q '"test": "echo' package.json; then
        if ! npm test --silent 2>/dev/null; then
            errors+=("Tests failed. Fix failing tests before stopping.")
        fi
    fi
fi

# 5. Check that Current Focus is set in CLAUDE.md
if [ -f "CLAUDE.md" ]; then
    if grep -q '\[Plumbing / Neural-Vision / Logic / Shield\]' CLAUDE.md; then
        errors+=("CLAUDE.md 'Current Focus' section not updated. Please set the current phase.")
    fi
fi

# 6. Check if branch is pushed to remote
if git status 2>/dev/null | grep -q "Your branch is ahead"; then
    errors+=("Branch not pushed to remote. Please push your changes.")
fi

# 7. Check if a PR exists for this branch (requires gh CLI)
if command -v gh &> /dev/null; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    if [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
        PR_COUNT=$(gh pr list --head "$BRANCH" --state open --json number --jq length 2>/dev/null || echo "0")
        if [ "$PR_COUNT" -eq 0 ]; then
            errors+=("No PR exists for branch '$BRANCH'. Create a PR so Codex can review your changes.")
        fi
    fi
fi

# Output result
if [ ${#errors[@]} -gt 0 ]; then
    # Join errors with newlines
    reason=$(printf '%s\\n' "${errors[@]}")
    echo "{\"decision\": \"block\", \"reason\": \"$reason\"}"
    exit 0
else
    echo "{\"decision\": \"allow\"}"
    exit 0
fi
