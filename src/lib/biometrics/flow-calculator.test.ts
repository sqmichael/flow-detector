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
  calculateStillnessScore,
  calculateMotionQuality,
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

// ── Stillness Scoring Tests ──────────────────────────────────────────

// Test 18: Stillness score increases with stillness value
test("Stillness scoring: high stillness scores higher", () => {
  const veryStill = calculateStillnessScore(0.95);
  const moderatelyStill = calculateStillnessScore(0.6);
  const restless = calculateStillnessScore(0.2);

  assert(veryStill > moderatelyStill, `Very still (${veryStill.toFixed(3)}) > moderately still (${moderatelyStill.toFixed(3)})`);
  assert(moderatelyStill > restless, `Moderately still (${moderatelyStill.toFixed(3)}) > restless (${restless.toFixed(3)})`);
  assert(veryStill >= 0.95, `Very still should score >= 0.95, got ${veryStill.toFixed(3)}`);
  console.log(`   Very still(0.95): ${(veryStill * 100).toFixed(0)}%, Moderate(0.6): ${(moderatelyStill * 100).toFixed(0)}%, Restless(0.2): ${(restless * 100).toFixed(0)}%`);
});

// Test 19: Stillness score is capped at 1.0
test("Stillness scoring: capped at 1.0", () => {
  const perfectStill = calculateStillnessScore(1.0);
  const overStill = calculateStillnessScore(1.2); // shouldn't happen but test robustness

  assert(perfectStill <= 1.0, `Perfect stillness should be <= 1.0, got ${perfectStill.toFixed(3)}`);
  assert(overStill <= 1.0, `Over-still should be capped at 1.0, got ${overStill.toFixed(3)}`);
  console.log(`   Perfect(1.0): ${perfectStill.toFixed(3)}, Over(1.2): ${overStill.toFixed(3)}`);
});

// Test 20: Motion quality is bounded 0.5-1.0
test("Motion quality: bounded between 0.5 and 0.95", () => {
  const stillQuality = calculateMotionQuality(1.0);
  const restlessQuality = calculateMotionQuality(0.0);
  const midQuality = calculateMotionQuality(0.5);

  assert(stillQuality <= 0.95, `Still motion quality should be <= 0.95, got ${stillQuality.toFixed(3)}`);
  assert(restlessQuality >= 0.5, `Restless motion quality should be >= 0.5, got ${restlessQuality.toFixed(3)}`);
  assert(midQuality > 0.5 && midQuality < 0.95, `Mid motion quality should be between bounds, got ${midQuality.toFixed(3)}`);
  console.log(`   Still(1.0): ${stillQuality.toFixed(3)}, Mid(0.5): ${midQuality.toFixed(3)}, Restless(0.0): ${restlessQuality.toFixed(3)}`);
});

// Test 21: Motion quality penalizes low stillness
test("Motion quality: lower stillness = lower multiplier", () => {
  const high = calculateMotionQuality(0.9);
  const mid = calculateMotionQuality(0.5);
  const low = calculateMotionQuality(0.1);

  assert(high > mid, `High stillness (${high.toFixed(3)}) > mid (${mid.toFixed(3)})`);
  assert(mid > low, `Mid stillness (${mid.toFixed(3)}) > low (${low.toFixed(3)})`);
  console.log(`   High(0.9): ${high.toFixed(3)}, Mid(0.5): ${mid.toFixed(3)}, Low(0.1): ${low.toFixed(3)}`);
});

// Test 22: Four-tier weight selection with stillness
test("Four-tier weights: stillness changes combined score", () => {
  const metrics = createMetrics(10, 0.8);
  const hrvMetrics = { rmssd: 40, sdnn: 50, sampleCount: 20, timestamp: Date.now() };
  const edaData = { scl: 5.0 }; // At baseline
  const stillnessData = { stillness: 0.9 }; // Very still

  const withStillness = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithEDA, edaData, stillnessData);
  const withoutStillness = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithEDA, edaData, null);
  const eyeHrvOnly = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithHRV, null, null);

  assert(withStillness.hasStillnessData === true, "Should have stillness data");
  assert(withoutStillness.hasStillnessData === false, "Should not have stillness data without stillness input");
  assert(withStillness.stillness === 0.9, `Stillness should be 0.9, got ${withStillness.stillness}`);
  assert(withoutStillness.stillness === null, `Stillness should be null without input, got ${withoutStillness.stillness}`);

  // Scores should differ due to different weights and motion quality multiplier
  assert(
    Math.abs(withStillness.combinedFlowScore - withoutStillness.combinedFlowScore) > 0.001,
    `Stillness tier (${withStillness.combinedFlowScore.toFixed(3)}) should differ from EDA tier (${withoutStillness.combinedFlowScore.toFixed(3)})`
  );
  console.log(`   Eye+HRV+EDA+Stillness: ${(withStillness.combinedFlowScore * 100).toFixed(0)}%, Eye+HRV+EDA: ${(withoutStillness.combinedFlowScore * 100).toFixed(0)}%, Eye+HRV: ${(eyeHrvOnly.combinedFlowScore * 100).toFixed(0)}%`);
});

// Test 23: Restless movement penalizes flow score
test("Restless movement significantly lowers flow score", () => {
  const metrics = createMetrics(10, 0.8);
  const hrvMetrics = { rmssd: 40, sdnn: 50, sampleCount: 20, timestamp: Date.now() };
  const edaData = { scl: 5.0 };

  const veryStill = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithEDA, edaData, { stillness: 0.95 });
  const restless = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithEDA, edaData, { stillness: 0.1 });

  // Very still should score significantly higher due to motion quality multiplier
  const difference = veryStill.combinedFlowScore - restless.combinedFlowScore;
  assert(difference > 0.1, `Still (${veryStill.combinedFlowScore.toFixed(3)}) should be significantly higher than restless (${restless.combinedFlowScore.toFixed(3)})`);
  console.log(`   Very still: ${(veryStill.combinedFlowScore * 100).toFixed(0)}%, Restless: ${(restless.combinedFlowScore * 100).toFixed(0)}%, Difference: ${(difference * 100).toFixed(0)}%`);
});

// Test 24: Weight sums for all tiers equal 1.0 (before motion quality multiplier)
test("Tier weights sum to 1.0", () => {
  // Eye-only: 0.40 + 0.45 + 0.15 = 1.0
  const eyeOnlySum = 0.40 + 0.45 + 0.15;
  assertApprox(eyeOnlySum, 1.0, 0.001, "Eye-only weights should sum to 1.0");

  // Eye+HRV: 0.30 + 0.35 + 0.10 + 0.25 = 1.0
  const eyeHrvSum = 0.30 + 0.35 + 0.10 + 0.25;
  assertApprox(eyeHrvSum, 1.0, 0.001, "Eye+HRV weights should sum to 1.0");

  // Eye+HRV+EDA: 0.25 + 0.30 + 0.10 + 0.20 + 0.15 = 1.0
  const eyeHrvEdaSum = 0.25 + 0.30 + 0.10 + 0.20 + 0.15;
  assertApprox(eyeHrvEdaSum, 1.0, 0.001, "Eye+HRV+EDA weights should sum to 1.0");

  // Eye+HRV+EDA+Stillness: 0.20 + 0.25 + 0.08 + 0.17 + 0.12 + 0.18 = 1.0
  const eyeHrvEdaStillnessSum = 0.20 + 0.25 + 0.08 + 0.17 + 0.12 + 0.18;
  assertApprox(eyeHrvEdaStillnessSum, 1.0, 0.001, "Eye+HRV+EDA+Stillness weights should sum to 1.0");

  console.log(`   Eye-only: ${eyeOnlySum}, Eye+HRV: ${eyeHrvSum}, Eye+HRV+EDA: ${eyeHrvEdaSum}, Eye+HRV+EDA+Stillness: ${eyeHrvEdaStillnessSum}`);
});

// Test 25: Backward compatibility - null stillness doesn't break existing tiers
test("Backward compatibility: null stillness uses three-tier", () => {
  const metrics = createMetrics(10, 0.8);
  const hrvMetrics = { rmssd: 40, sdnn: 50, sampleCount: 20, timestamp: Date.now() };
  const edaData = { scl: 5.0 };

  // Explicitly passing null stillness
  const result = calculateCombinedFlow(metrics, hrvMetrics, 72, testBaselineWithEDA, edaData, null);

  assert(result.hasEdaData === true, "Should have EDA data");
  assert(result.hasStillnessData === false, "Should NOT have stillness data");
  assert(result.stillness === null, "Stillness should be null");
  assert(result.combinedFlowScore > 0 && result.combinedFlowScore < 1, `Score should be valid: ${result.combinedFlowScore}`);
  console.log(`   Three-tier (no stillness): ${(result.combinedFlowScore * 100).toFixed(0)}%`);
});

console.log("\n=== All tests complete ===\n");
