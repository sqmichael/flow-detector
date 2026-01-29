#!/bin/bash

# Flow Detector - UX Verification Script
# This script outputs context for UX verification by the reviewing agent.

cd "$CLAUDE_PROJECT_DIR" || exit 1

echo "=== UX VERIFICATION CONTEXT ==="
echo ""

# Determine diff range based on working tree state
DIFF_RANGE=""
DIFF_DESCRIPTION=""

if [ -n "$(git status --porcelain)" ]; then
    # Uncommitted changes exist - diff against HEAD
    DIFF_RANGE="HEAD"
    DIFF_DESCRIPTION="uncommitted changes"
else
    # Working tree is clean - find appropriate comparison base
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

    # Try to find merge-base with main/master
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
        BASE_BRANCH="origin/main"
    elif git rev-parse --verify origin/master >/dev/null 2>&1; then
        BASE_BRANCH="origin/master"
    elif git rev-parse --verify main >/dev/null 2>&1; then
        BASE_BRANCH="main"
    elif git rev-parse --verify master >/dev/null 2>&1; then
        BASE_BRANCH="master"
    else
        BASE_BRANCH=""
    fi

    if [ -n "$BASE_BRANCH" ] && [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
        # On a feature branch - diff from merge-base with main
        MERGE_BASE=$(git merge-base "$BASE_BRANCH" HEAD 2>/dev/null)
        if [ -n "$MERGE_BASE" ]; then
            DIFF_RANGE="${MERGE_BASE}..HEAD"
            DIFF_DESCRIPTION="branch changes since $BASE_BRANCH"
        fi
    fi

    # Fallback to last commit if no branch diff available
    if [ -z "$DIFF_RANGE" ]; then
        DIFF_RANGE="HEAD~1..HEAD"
        DIFF_DESCRIPTION="last commit"
    fi
fi

echo "## Recent File Changes"
echo "Scanning: $DIFF_DESCRIPTION"
echo ""

if [ "$DIFF_RANGE" = "HEAD" ]; then
    echo "Modified files:"
    git status --porcelain | head -20
    echo ""
    echo "Diff summary:"
    git diff --stat HEAD 2>/dev/null | tail -10
else
    echo "Commits in range:"
    git log --oneline "$DIFF_RANGE" 2>/dev/null | head -10
    echo ""
    echo "Diff summary:"
    git diff --stat "$DIFF_RANGE" 2>/dev/null | tail -10
fi
echo ""

# Check for UX-sensitive patterns in the determined diff range
echo "## UX-Sensitive Pattern Scan"

FOUND_ISSUES=0

# Check for notification-related code
if git diff "$DIFF_RANGE" 2>/dev/null | grep -iE "(notification|alert|popup|modal|toast)" > /dev/null; then
    echo "WARNING: Changes contain notification/alert patterns. Verify against B1 (Noise Violations)."
    FOUND_ISSUES=1
fi

# Check for emotion-detection or labeling code
if git diff "$DIFF_RANGE" 2>/dev/null | grep -iE "(you seem|you sound|you are feeling|stressed|anxious|tired)" > /dev/null; then
    echo "WARNING: Changes contain emotion-labeling patterns. Verify against B2 (Authority Violations)."
    FOUND_ISSUES=1
fi

# Check for gamification patterns
if git diff "$DIFF_RANGE" 2>/dev/null | grep -iE "(streak|badge|score|points|daily|achievement)" > /dev/null; then
    echo "WARNING: Changes contain gamification patterns. Verify against B3 (Dependency Violations)."
    FOUND_ISSUES=1
fi

# Check for data persistence
if git diff "$DIFF_RANGE" 2>/dev/null | grep -iE "(localStorage|indexedDB|persist|save.*emotion|store.*feeling)" > /dev/null; then
    echo "WARNING: Changes contain persistence patterns. Verify against B4 (Memory/Privacy Violations)."
    FOUND_ISSUES=1
fi

# Check for verbose AI responses
if git diff "$DIFF_RANGE" 2>/dev/null | grep -iE "(I am processing|I am reasoning|analyzing your|let me analyze)" > /dev/null; then
    echo "WARNING: Changes contain verbose AI patterns. Verify against B5 (Latency/Presence Violations)."
    FOUND_ISSUES=1
fi

if [ $FOUND_ISSUES -eq 0 ]; then
    echo "No obvious UX-sensitive patterns detected."
fi

echo ""
echo "## UX Verification Checklist"
echo ""
echo "Review the changes against UX_PRINCIPLES.md:"
echo ""
echo "BLOCKING VIOLATIONS (must fix):"
echo "  [ ] B1: Does this add noise during flow? (notifications, dashboards, timers)"
echo "  [ ] B2: Does this tell the user what they're feeling?"
echo "  [ ] B3: Does this encourage dependency? (streaks, gamification)"
echo "  [ ] B4: Does this silently persist emotional data?"
echo "  [ ] B5: Does this create dead air without social cues?"
echo "  [ ] B6: Is this over-engineered?"
echo ""
echo "VERIFICATION QUESTIONS:"
echo "  1. Would the user notice this if it's working? (ideally: no)"
echo "  2. Does this add noise during flow? (must be: no)"
echo "  3. Does this tell user what they're feeling? (must be: no)"
echo "  4. Could this create dependency? (should be: unlikely)"
echo "  5. Is this the simplest version? (should be: yes)"
echo ""
echo "=== END UX VERIFICATION CONTEXT ==="
