/**
 * Flow Calculator Tests
 *
 * Run with: npx ts-node --esm src/lib/biometrics/flow-calculator.test.ts
 * Or: npx tsx src/lib/biometrics/flow-calculator.test.ts
 */

import {
  calculateCalibratedEyeFlowScore,
  updateFlowDetector,
  createFlowDetectorState,
} from "./flow-calculator";
import type { AggregatedEyeMetrics } from "../mediapipe/types";
import type { WorkingBaselineCalibration } from "../calibration/types";

// Test baseline: typical person who blinks 15/min with 60% gaze stability
const testBaseline: WorkingBaselineCalibration = {
  blinkRateMean: 15,
  blinkRateStdDev: 3,
  gazeStabilityMean: 0.6,
  gazeStabilityStdDev: 0.1,
  earMean: 0.28,
  earStdDev: 0.02,
  captureDurationMs: 60000,
  windowCount: 12,
};

function createMetrics(
  blinkRate: number,
  gazeStability: number,
  averageEAR: number = 0.28
): AggregatedEyeMetrics {
  return {
    blinkRate,
    gazeStability,
    averageEAR,
    eyeFlowIndicator: 0, // Will be calculated
    windowStart: 0,
    windowEnd: 5000,
    frameCount: 150,
  };
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(`   ${e}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected.toFixed(3)}, got ${actual.toFixed(3)}`);
  }
}

console.log("\n=== Flow Calculator Tests ===\n");

// Test 1: Flow state should score high
test("Flow state (low blinks, high gaze stability) scores high", () => {
  // 8 blinks/min is well below baseline of 15
  // 0.85 gaze stability is well above baseline of 0.6
  const metrics = createMetrics(8, 0.85);
  const score = calculateCalibratedEyeFlowScore(metrics, testBaseline);

  assert(score >= 0.7, `Score ${score.toFixed(3)} should be >= 0.7 for flow state`);
  console.log(`   Score: ${(score * 100).toFixed(0)}%`);
});

// Test 2: Baseline state should score around 0.5
test("Baseline state (normal blinks, normal gaze) scores around 0.5", () => {
  // Exactly at baseline values
  const metrics = createMetrics(15, 0.6);
  const score = calculateCalibratedEyeFlowScore(metrics, testBaseline);

  assertApprox(score, 0.5, 0.15, "Baseline should score around 0.5");
  console.log(`   Score: ${(score * 100).toFixed(0)}%`);
});

// Test 3: Distracted state should score low
test("Distracted state (high blinks, low gaze stability) scores low", () => {
  // 25 blinks/min is well above baseline
  // 0.3 gaze stability is well below baseline
  const metrics = createMetrics(25, 0.3);
  const score = calculateCalibratedEyeFlowScore(metrics, testBaseline);

  assert(score <= 0.4, `Score ${score.toFixed(3)} should be <= 0.4 for distracted state`);
  console.log(`   Score: ${(score * 100).toFixed(0)}%`);
});

// Test 4: Very low blink rate (near-zero) shouldn't be perfect
test("Extremely low blink rate (2/min) slightly lower than optimal (6/min)", () => {
  // 2 blinks/min might indicate strain, not ideal flow
  const metrics2 = createMetrics(2, 0.8);
  const score2 = calculateCalibratedEyeFlowScore(metrics2, testBaseline);

  // 6 blinks/min is the sweet spot (~1.5 std below baseline)
  const metrics6 = createMetrics(6, 0.8);
  const score6 = calculateCalibratedEyeFlowScore(metrics6, testBaseline);

  // Both should be high, but 6/min should be slightly better or equal
  assert(score6 >= score2, `6/min (${score6.toFixed(3)}) should score >= 2/min (${score2.toFixed(3)})`);
  console.log(`   2/min: ${(score2 * 100).toFixed(0)}%, 6/min: ${(score6 * 100).toFixed(0)}%`);
});

// Test 5: Without calibration, fallback thresholds work
test("Without calibration, uses fallback thresholds", () => {
  const flowMetrics = createMetrics(8, 0.8);
  const scoreWithCal = calculateCalibratedEyeFlowScore(flowMetrics, testBaseline);
  const scoreNoCal = calculateCalibratedEyeFlowScore(flowMetrics, null);

  // Both should indicate flow (high scores)
  assert(scoreWithCal >= 0.6, `Calibrated score ${scoreWithCal.toFixed(3)} should be >= 0.6`);
  assert(scoreNoCal >= 0.6, `Uncalibrated score ${scoreNoCal.toFixed(3)} should be >= 0.6`);
  console.log(`   With calibration: ${(scoreWithCal * 100).toFixed(0)}%, Without: ${(scoreNoCal * 100).toFixed(0)}%`);
});

// Test 6: EMA smoothing works correctly
test("EMA smoothing reduces volatility", () => {
  let state = createFlowDetectorState();
  const scores = [0.8, 0.3, 0.9, 0.2, 0.85]; // Volatile raw scores

  let now = Date.now();
  for (const score of scores) {
    state = updateFlowDetector(state, score, now);
    now += 5000;
  }

  // Smoothed score should be somewhere in the middle, not jumping to extremes
  assert(state.smoothedScore > 0.3 && state.smoothedScore < 0.8,
    `Smoothed score ${state.smoothedScore.toFixed(3)} should be between 0.3 and 0.8`);
  console.log(`   Raw scores: [${scores.join(", ")}] → Smoothed: ${(state.smoothedScore * 100).toFixed(0)}%`);
});

// Test 7: Flow confirmation requires sustained duration
test("Flow confirmation requires 2 minutes above threshold", () => {
  let state = createFlowDetectorState();
  state.smoothedScore = 0.5; // Start at baseline

  let now = Date.now();

  // Simulate 1 minute of high scores
  for (let i = 0; i < 12; i++) {
    state = updateFlowDetector(state, 0.8, now);
    now += 5000;
  }

  assert(!state.inFlow, "Should NOT be in flow after just 1 minute");
  assert(state.flowOnsetTime !== null, "Should have onset time tracking");
  console.log(`   After 1 min: inFlow=${state.inFlow}, confidence=${(state.confidence * 100).toFixed(0)}%`);

  // Simulate another 1.5 minutes (total 2.5 minutes)
  for (let i = 0; i < 18; i++) {
    state = updateFlowDetector(state, 0.8, now);
    now += 5000;
  }

  assert(state.inFlow, "SHOULD be in flow after 2.5 minutes");
  assert(state.confidence > 0.3, "Confidence should be building");
  console.log(`   After 2.5 min: inFlow=${state.inFlow}, confidence=${(state.confidence * 100).toFixed(0)}%`);
});

// Test 8: Dropping below threshold resets flow
test("Dropping below threshold resets flow onset", () => {
  let state = createFlowDetectorState();
  state.smoothedScore = 0.7;
  state.flowOnsetTime = Date.now() - 180000; // 3 minutes ago
  state.inFlow = true;
  state.confidence = 0.6;

  // Drop below threshold
  state = updateFlowDetector(state, 0.3, Date.now());

  // Keep dropping (EMA needs multiple samples to drop significantly)
  for (let i = 0; i < 10; i++) {
    state = updateFlowDetector(state, 0.3, Date.now() + i * 5000);
  }

  assert(!state.inFlow, "Should exit flow when score drops");
  assert(state.flowOnsetTime === null, "Onset time should be reset");
  console.log(`   After dropping: inFlow=${state.inFlow}, smoothed=${(state.smoothedScore * 100).toFixed(0)}%`);
});

// Test 9: Z-score calculation sanity check
test("Z-score math: 1.5 std below baseline gives high blink score", () => {
  // Baseline: 15 blinks/min, stdDev: 3
  // 1.5 std below = 15 - (1.5 * 3) = 10.5 blinks/min
  const metrics = createMetrics(10.5, 0.6, 0.28);
  const score = calculateCalibratedEyeFlowScore(metrics, testBaseline);

  // With blink at optimal z=-1.5, gaze at z=0, EAR at z=0:
  // Blink score ~1.0 (at target), Gaze score ~0.5 (sigmoid at 0), EAR ~1.0 (at target)
  // Weighted: 1.0*0.4 + 0.5*0.45 + 1.0*0.15 = 0.4 + 0.225 + 0.15 = 0.775
  assertApprox(score, 0.77, 0.1, "Score at optimal blink z-score");
  console.log(`   10.5 blinks/min (z=-1.5): ${(score * 100).toFixed(0)}%`);
});

// Test 10: Score ranges are reasonable across the spectrum
test("Score ranges across different states", () => {
  // Note: Blink rate scoring is Gaussian around z=-1.5 (optimal ~10.5/min with baseline 15)
  // So "optimal flow" at 10/min scores higher than "deep flow" at 5/min (too low = potential strain)
  const scenarios = [
    { name: "Optimal flow", blink: 10, gaze: 0.85 },
    { name: "Deep focus (slight strain)", blink: 5, gaze: 0.9 },
    { name: "Normal work", blink: 15, gaze: 0.6 },
    { name: "Tired", blink: 20, gaze: 0.5 },
    { name: "Very distracted", blink: 25, gaze: 0.35 },
  ];

  console.log("   Scenario scores:");
  const scores: number[] = [];
  for (const s of scenarios) {
    const metrics = createMetrics(s.blink, s.gaze);
    const score = calculateCalibratedEyeFlowScore(metrics, testBaseline);
    scores.push(score);
    console.log(`     ${s.name}: ${(score * 100).toFixed(0)}%`);
  }

  // Verify key relationships:
  // 1. Optimal flow should be highest
  assert(scores[0] >= scores[1], "Optimal flow should score >= deep focus");
  assert(scores[0] >= scores[2], "Optimal flow should score >= normal work");

  // 2. Normal work through distracted should decrease monotonically
  assert(scores[2] >= scores[3], "Normal work should score >= tired");
  assert(scores[3] >= scores[4], "Tired should score >= very distracted");

  // 3. Very distracted should be lowest
  assert(scores[4] <= 0.4, "Very distracted should be low");
});

console.log("\n=== All tests complete ===\n");
