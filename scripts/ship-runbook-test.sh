#!/usr/bin/env bash
set -euo pipefail

SHIP_FILE=".ralph/feature/current/SHIP.md"

if [[ ! -f "$SHIP_FILE" ]]; then
  echo "FAIL: missing $SHIP_FILE"
  exit 1
fi

grep -q "## Environment Variables" "$SHIP_FILE" || { echo "FAIL: missing Environment Variables section"; exit 1; }
grep -q '`NTFY_TOPIC`' "$SHIP_FILE" || { echo "FAIL: missing NTFY_TOPIC env var"; exit 1; }
grep -q '`OPENROUTER_API_KEY`' "$SHIP_FILE" || { echo "FAIL: missing OPENROUTER_API_KEY env var"; exit 1; }

grep -q "## Shadow Mode (3-5 Days)" "$SHIP_FILE" || { echo "FAIL: missing Shadow Mode section"; exit 1; }
grep -q "flow-detector-shadow" "$SHIP_FILE" || { echo "FAIL: missing shadow topic guidance"; exit 1; }
grep -q "timing-score.ts" "$SHIP_FILE" || { echo "FAIL: missing timing-score command"; exit 1; }

grep -q "## Go/No-Go Metrics (Review After Day 3-5)" "$SHIP_FILE" || { echo "FAIL: missing go/no-go section"; exit 1; }
grep -q "mistimedRate" "$SHIP_FILE" || { echo "FAIL: missing mistimedRate metric"; exit 1; }
grep -q "missingTimingPolicy" "$SHIP_FILE" || { echo "FAIL: missing missingTimingPolicy metric"; exit 1; }

echo "PASS: ship runbook requirements present"
