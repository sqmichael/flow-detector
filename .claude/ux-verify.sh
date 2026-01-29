#!/bin/bash

# Flow Detector - UX Verification Script
# This script outputs context for UX verification by the reviewing agent.

cd "$CLAUDE_PROJECT_DIR" || exit 1

echo "=== UX VERIFICATION CONTEXT ==="
echo ""

# Get recent changes
echo "## Recent File Changes"
if [ -n "$(git status --porcelain)" ]; then
    echo "Modified files:"
    git status --porcelain | head -20
    echo ""
    echo "Diff summary:"
    git diff --stat HEAD 2>/dev/null | tail -10
else
    echo "No uncommitted changes."
fi
echo ""

# Check for UX-sensitive patterns in recent changes
echo "## UX-Sensitive Pattern Scan"

# Check for notification-related code
if git diff HEAD 2>/dev/null | grep -iE "(notification|alert|popup|modal|toast)" > /dev/null; then
    echo "WARNING: Changes contain notification/alert patterns. Verify against B1 (Noise Violations)."
fi

# Check for emotion-detection or labeling code
if git diff HEAD 2>/dev/null | grep -iE "(you seem|you sound|you are feeling|stressed|anxious|tired)" > /dev/null; then
    echo "WARNING: Changes contain emotion-labeling patterns. Verify against B2 (Authority Violations)."
fi

# Check for gamification patterns
if git diff HEAD 2>/dev/null | grep -iE "(streak|badge|score|points|daily|achievement)" > /dev/null; then
    echo "WARNING: Changes contain gamification patterns. Verify against B3 (Dependency Violations)."
fi

# Check for data persistence
if git diff HEAD 2>/dev/null | grep -iE "(localStorage|indexedDB|persist|save.*emotion|store.*feeling)" > /dev/null; then
    echo "WARNING: Changes contain persistence patterns. Verify against B4 (Memory/Privacy Violations)."
fi

# Check for verbose AI responses
if git diff HEAD 2>/dev/null | grep -iE "(I am processing|I am reasoning|analyzing your|let me analyze)" > /dev/null; then
    echo "WARNING: Changes contain verbose AI patterns. Verify against B5 (Latency/Presence Violations)."
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
