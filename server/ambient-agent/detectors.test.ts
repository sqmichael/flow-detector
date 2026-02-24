/**
 * Detector tests for stress false-positive guard.
 *
 * Run: npx tsx server/ambient-agent/detectors.test.ts
 */

import { detectStressPattern, type SensorSample } from "./detectors";
import type { PersonalBaseline, StressDetectionConfig } from "./types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}: ${msg}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const baseline: PersonalBaseline = {
  restingHR: 65,
  baselineHRV: 40,
  updatedAt: Date.now(),
};

const stressConfig: StressDetectionConfig = {
  hrElevatedAboveBaseline: 10,
  hrvSuppressedBelowBaseline: 0.7,
  durationMinutes: 15,
};

function makeHistoryFlat(now: number, hr: number, count = 12): SensorSample[] {
  const samples: SensorSample[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({
      hr,
      timestamp: now - (count - i) * 30_000,
    });
  }
  return samples;
}

function makeHistoryRising(now: number): SensorSample[] {
  // Prior 3 minutes around 72 bpm, recent 2 minutes around 79 bpm.
  const samples: SensorSample[] = [];
  for (let i = 0; i < 10; i++) {
    const minutesAgo = 5 - i * 0.5;
    const isRecent = minutesAgo <= 2;
    samples.push({
      hr: isRecent ? 79 : 72,
      timestamp: now - Math.floor(minutesAgo * 60_000),
    });
  }
  return samples;
}

console.log("\nStress detector guard tests\n");

test("does not flag stress for passive elevated state without corroborating signals", () => {
  const now = Date.now();
  const result = detectStressPattern(
    78,
    24, // suppressed vs baseline 40*0.7=28
    baseline,
    now - 20 * 60_000,
    stressConfig,
    {
      hrHistory: makeHistoryFlat(now, 78),
      currentSCL: 2.1, // not elevated
      baselineSCL: 2.0,
      currentStillness: 0.9, // very still
    }
  );

  assert(!result.isStressed, "should be suppressed by passive-viewing guard");
  assert(!result.shouldTriggerCheckin, "should not trigger checkin");
});

test("flags stress when HR/HRV pattern is corroborated by rising HR", () => {
  const now = Date.now();
  const result = detectStressPattern(
    78,
    24,
    baseline,
    now - 20 * 60_000,
    stressConfig,
    {
      hrHistory: makeHistoryRising(now),
      currentSCL: 2.1,
      baselineSCL: 2.0,
      currentStillness: 0.9,
    }
  );

  assert(result.isStressed, "rising HR should corroborate stress");
  assert(result.shouldTriggerCheckin, "duration should permit trigger");
});

test("flags stress when corroborated by restless motion", () => {
  const now = Date.now();
  const result = detectStressPattern(
    80,
    23,
    baseline,
    now - 16 * 60_000,
    stressConfig,
    {
      hrHistory: makeHistoryFlat(now, 80),
      currentSCL: 2.2,
      baselineSCL: 2.0,
      currentStillness: 0.4,
    }
  );

  assert(result.isStressed, "low stillness should corroborate stress");
});

if (failed > 0) {
  console.log(`\nFAILED: ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\nPASS: ${passed} test(s) passed`);

