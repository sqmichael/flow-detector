/**
 * Flow Calculator Tests
 *
 * Run with: npx ts-node --esm src/lib/biometrics/flow-calculator.test.ts
 * Or: npx tsx src/lib/biometrics/flow-calculator.test.ts
 */

import {
  calculateCalibratedEyeFlowScore,
  calculateHRVScore,
  calculateEDAScore,
  updateFlowDetector,
  createFlowDetectorState,
  calculateCombinedFlow,
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

// Test baseline with HRV data
const testBaselineWithHRV: WorkingBaselineCalibration = {
  ...testBaseline,
  hrvRmssdMean: 45,
  hrvRmssdStdDev: 10,
  hrvSampleCount: 5,
};

// Test 11: HRV scoring with calibrated baseline
test("HRV scoring: optimal RMSSD (z=-0.5) scores highest", () => {
  // z = -0.5 → RMSSD = 45 - 0.5*10 = 40ms (at Gaussian peak)
  const optimal = calculateHRVScore(40, testBaselineWithHRV);

  // High stress: RMSSD = 10ms → z = -3.5
  const stressed = calculateHRVScore(10, testBaselineWithHRV);

  // Drowsy: RMSSD = 80ms → z = 3.5
  const drowsy = calculateHRVScore(80, testBaselineWithHRV);

  assert(optimal > stressed, `Optimal (${optimal.toFixed(3)}) should score > stressed (${stressed.toFixed(3)})`);
  assert(optimal > drowsy, `Optimal (${optimal.toFixed(3)}) should score > drowsy (${drowsy.toFixed(3)})`);
  assert(optimal >= 0.9, `Optimal should be >= 0.9, got ${optimal.toFixed(3)}`);
  console.log(`   Optimal(40ms): ${(optimal * 100).toFixed(0)}%, Stressed(10ms): ${(stressed * 100).toFixed(0)}%, Drowsy(80ms): ${(drowsy * 100).toFixed(0)}%`);
});

// Test 12: Combined flow with HRV vs eye-only
test("Combined flow with HRV produces different score than eye-only", () => {
  const metrics = createMetrics(10, 0.8);
  const hrvMetrics = { rmssd: 40, sdnn: 50, sampleCount: 20, timestamp: Date.now() };

  const withHRV = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithHRV);
  const eyeOnly = calculateCombinedFlow(metrics, null, 72, testBaseline);

  assert(withHRV.hasWatchData === true, "Should have watch data when HRV present");
  assert(eyeOnly.hasWatchData === false, "Should not have watch data when HRV null");
  assert(
    Math.abs(withHRV.combinedFlowScore - eyeOnly.combinedFlowScore) > 0.01,
    `Scores should differ: HRV=${withHRV.combinedFlowScore.toFixed(3)}, eye=${eyeOnly.combinedFlowScore.toFixed(3)}`
  );
  console.log(`   With HRV: ${(withHRV.combinedFlowScore * 100).toFixed(0)}%, Eye-only: ${(eyeOnly.combinedFlowScore * 100).toFixed(0)}%`);
});

// Test 13: HRV scoring without baseline uses absolute thresholds
test("HRV scoring without baseline uses absolute thresholds", () => {
  const good = calculateHRVScore(40, null); // 25-70ms range
  const ok = calculateHRVScore(15, null);   // 15-90ms range
  const bad = calculateHRVScore(5, null);   // outside both ranges

  assertApprox(good, 0.8, 0.01, "40ms should score 0.8");
  assertApprox(ok, 0.6, 0.01, "15ms should score 0.6");
  assertApprox(bad, 0.4, 0.01, "5ms should score 0.4");
  console.log(`   Good(40ms): ${good}, OK(15ms): ${ok}, Bad(5ms): ${bad}`);
});

// ── EDA Scoring Tests ──────────────────────────────────────────

// Test baseline with EDA data
const testBaselineWithEDA: WorkingBaselineCalibration = {
  ...testBaselineWithHRV,
  edaSclMean: 5.0,
  edaSclStdDev: 1.5,
  edaSampleCount: 25,
};

// Test 14: EDA scoring with baseline — at baseline scores highest
test("EDA scoring: at personal baseline (z=0) scores highest", () => {
  const atBaseline = calculateEDAScore(5.0, testBaselineWithEDA); // z = 0
  const highArousal = calculateEDAScore(9.5, testBaselineWithEDA); // z = 3.0
  const lowArousal = calculateEDAScore(0.5, testBaselineWithEDA); // z = -3.0

  assert(atBaseline >= 0.95, `At baseline should score >= 0.95, got ${atBaseline.toFixed(3)}`);
  assert(atBaseline > highArousal, `Baseline (${atBaseline.toFixed(3)}) > high arousal (${highArousal.toFixed(3)})`);
  assert(atBaseline > lowArousal, `Baseline (${atBaseline.toFixed(3)}) > low arousal (${lowArousal.toFixed(3)})`);
  console.log(`   At baseline(5.0): ${(atBaseline * 100).toFixed(0)}%, High(9.5): ${(highArousal * 100).toFixed(0)}%, Low(0.5): ${(lowArousal * 100).toFixed(0)}%`);
});

// Test 15: EDA scoring without baseline uses absolute thresholds
test("EDA scoring: without baseline uses absolute thresholds", () => {
  const moderate = calculateEDAScore(6.0, null); // in 2-10 range
  const borderline = calculateEDAScore(12.0, null); // in 1-15 range but not 2-10
  const extreme = calculateEDAScore(25.0, null); // outside all ranges

  assertApprox(moderate, 0.8, 0.01, "6.0 µS should score 0.8");
  assertApprox(borderline, 0.6, 0.01, "12.0 µS should score 0.6");
  assertApprox(extreme, 0.4, 0.01, "25.0 µS should score 0.4");
  console.log(`   Moderate(6.0): ${moderate}, Borderline(12.0): ${borderline}, Extreme(25.0): ${extreme}`);
});

// Test 16: Three-tier weight selection — eye+HRV+EDA uses different weights than eye+HRV
test("Three-tier weights: EDA changes combined score", () => {
  const metrics = createMetrics(10, 0.8);
  const hrvMetrics = { rmssd: 40, sdnn: 50, sampleCount: 20, timestamp: Date.now() };
  const edaData = { scl: 5.0 }; // At baseline

  const withEDA = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithEDA, edaData);
  const withoutEDA = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithHRV, null);
  const eyeOnly = calculateCombinedFlow(metrics, null, 72, testBaseline, null);

  assert(withEDA.hasEdaData === true, "Should have EDA data");
  assert(withEDA.hasWatchData === true, "Should have watch data");
  assert(withoutEDA.hasEdaData === false, "Should not have EDA data");
  assert(withoutEDA.hasWatchData === true, "Should have watch data");
  assert(eyeOnly.hasEdaData === false, "Eye-only should not have EDA");
  assert(eyeOnly.hasWatchData === false, "Eye-only should not have watch data");

  // All three should produce different scores due to different weights
  assert(
    Math.abs(withEDA.combinedFlowScore - withoutEDA.combinedFlowScore) > 0.001,
    `EDA tier (${withEDA.combinedFlowScore.toFixed(3)}) should differ from HRV tier (${withoutEDA.combinedFlowScore.toFixed(3)})`
  );
  console.log(`   Eye+HRV+EDA: ${(withEDA.combinedFlowScore * 100).toFixed(0)}%, Eye+HRV: ${(withoutEDA.combinedFlowScore * 100).toFixed(0)}%, Eye-only: ${(eyeOnly.combinedFlowScore * 100).toFixed(0)}%`);
});

// Test 17: EDA SCL is passed through to combined metrics
test("Combined flow includes SCL value when EDA data provided", () => {
  const metrics = createMetrics(10, 0.8);
  const hrvMetrics = { rmssd: 40, sdnn: 50, sampleCount: 20, timestamp: Date.now() };

  const withEDA = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithEDA, { scl: 7.5 });
  const withoutEDA = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithHRV, null);

  assert(withEDA.scl === 7.5, `SCL should be 7.5, got ${withEDA.scl}`);
  assert(withoutEDA.scl === null, `SCL should be null without EDA, got ${withoutEDA.scl}`);
  console.log(`   With EDA: scl=${withEDA.scl}, Without: scl=${withoutEDA.scl}`);
});

console.log("\n=== All tests complete ===\n");
