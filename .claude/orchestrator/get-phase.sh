#!/bin/bash

# Orchestrator Phase Guidance Script
# Reads state.json and outputs guidance for the current phase

# Use script's location to find project root (more robust than env var)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
cd "$PROJECT_DIR" || exit 1

STATE_FILE=".claude/orchestrator/state.json"
PHASES_DIR=".claude/orchestrator/phases"

# Check if state file exists
if [ ! -f "$STATE_FILE" ]; then
    echo "ORCHESTRATOR: No active iteration. Classify your task first:"
    echo "  question | bug | small | refactor | feature | major"
    echo "See .claude/orchestrator/ORCHESTRATOR.md for guidance."
    exit 0
fi

# Read state
ITERATION=$(cat "$STATE_FILE" | grep -o '"iteration":[^,}]*' | cut -d':' -f2 | tr -d ' "')
TASK_TYPE=$(cat "$STATE_FILE" | grep -o '"taskType":[^,}]*' | cut -d':' -f2 | tr -d ' "')
CURRENT_PHASE=$(cat "$STATE_FILE" | grep -o '"currentPhase":[^,}]*' | cut -d':' -f2 | tr -d ' "')

# No iteration active
if [ "$ITERATION" = "null" ] || [ -z "$ITERATION" ]; then
    echo "ORCHESTRATOR: No active iteration. Classify your task:"
    echo "  question | bug | small | refactor | feature | major"
    echo "Then run: Update .claude/orchestrator/state.json with iteration details."
    exit 0
fi

# Iteration active but no phase set
if [ "$CURRENT_PHASE" = "null" ] || [ -z "$CURRENT_PHASE" ]; then
    echo "ORCHESTRATOR: Iteration '$ITERATION' ($TASK_TYPE) — no phase set."
    echo "Check state.json and set currentPhase."
    exit 0
fi

# Output phase guidance
PHASE_FILE="$PHASES_DIR/$CURRENT_PHASE"

if [ -f "$PHASE_FILE" ]; then
    echo "ORCHESTRATOR: Iteration '$ITERATION' — Phase $CURRENT_PHASE"
    echo "Read: .claude/orchestrator/phases/$CURRENT_PHASE"
    echo "Output to: iterations/current.md"
else
    echo "ORCHESTRATOR: Phase file not found: $PHASE_FILE"
    echo "Valid phases: 1-assumptions.md, 2-user-story.md, 3-c4-map.md,"
    echo "              4-implementation.md, 5-tests-plan.md, 6-pr-checklist.md, 7-cicd-steps.md"
fi
