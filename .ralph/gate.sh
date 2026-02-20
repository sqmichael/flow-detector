#!/usr/bin/env bash
set -euo pipefail

# Ralph gate — runs after each task iteration.
# Exit 0 = pass, non-zero = fail (triggers retry).

echo "Running flow-calculator tests..."
npx tsx src/lib/biometrics/flow-calculator.test.ts

echo "Running TypeScript type check..."
npx tsc --noEmit --pretty

echo "All gates passed."
