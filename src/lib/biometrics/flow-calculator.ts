/**
 * Combined Flow Calculator
 *
 * Calculates a combined flow score from eye tracking, HRV, and EDA metrics
 * using z-score normalization against personal baselines.
 *
 * Research shows flow is characterized by:
 * - Blink rate BELOW personal baseline (visual absorption)
 * - Gaze stability ABOVE personal baseline (focused attention)
 * - HRV in moderate range (engaged but calm)
 * - EDA at or near personal baseline (moderate arousal, inverse-U)
 *
 * Uses Gaussian scoring curves for smooth transitions instead of step functions.
 */

import type { AggregatedEyeMetrics } from "../mediapipe/types";
import type { CombinedFlowMetrics, HRVMetrics } from "./types";
import type { WorkingBaselineCalibration } from "../calibration/types";

const DEBUG = false;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[Flow Calculator]", ...args);
  }
}

/**
 * Flow detector state for temporal smoothing
 */
export interface FlowDetectorState {
  /** Smoothed flow score (EMA) */
  smoothedScore: number;
  /** Timestamp when potential flow started */
  flowOnsetTime: number | null;
  /** Whether currently in confirmed flow state */
  inFlow: boolean;
  /** Confidence in current state (0-1) */
  confidence: number;
  /** Last update timestamp */
  lastUpdate: number;
}

/**
 * Create initial flow detector state
 */
export function createFlowDetectorState(): FlowDetectorState {
  return {
    smoothedScore: 0.5,
    flowOnsetTime: null,
    inFlow: false,
    confidence: 0,
    lastUpdate: Date.now(),
  };
}

/**
 * EMA smoothing factor
 * Lower = more smoothing, slower response
 * 0.15 gives ~20 sample half-life at 5s windows = ~100s to stabilize
 */
const EMA_ALPHA = 0.15;

/**
 * Threshold for considering flow state
 */
const FLOW_THRESHOLD = 0.65;

/**
 * Minimum duration (ms) above threshold to confirm flow
 * 2 minutes = research suggests flow takes time to develop
 */
const FLOW_MIN_DURATION_MS = 120000;

/**
 * Calculate z-score: how many standard deviations from baseline
 */
function zScore(current: number, mean: number, stdDev: number): number {
  if (stdDev === 0 || isNaN(stdDev)) return 0;
  return (current - mean) / stdDev;
}

/**
 * Gaussian scoring function
 *
 * Returns 1.0 when z equals target, falls off smoothly.
 * Width controls how quickly it falls off.
 *
 * @param z - Z-score of current value
 * @param target - Optimal z-score for flow (e.g., -1.0 for blink rate)
 * @param width - Standard deviation of the Gaussian (controls falloff speed)
 */
function gaussianScore(z: number, target: number, width: number): number {
  return Math.exp(-Math.pow(z - target, 2) / (2 * Math.pow(width, 2)));
}

/**
 * Sigmoid scoring function
 *
 * Returns values between 0 and 1, with smooth S-curve transition.
 * Useful when "more is better" or "less is better".
 *
 * @param z - Z-score of current value
 * @param k - Steepness of transition (higher = sharper)
 */
function sigmoidScore(z: number, k: number = 1.5): number {
  return 1 / (1 + Math.exp(-k * z));
}

/**
 * Calculate blink rate flow component
 *
 * Research shows blink rate DECREASES during flow (visual absorption).
 * We want z-score around -1 to -2 (below baseline).
 */
function calculateBlinkRateScore(
  blinkRate: number,
  baseline: WorkingBaselineCalibration | null
): number {
  if (!baseline) {
    // Fallback: use absolute thresholds (less accurate)
    // Optimal for flow: 5-10 blinks/min, normal: 15-20
    if (blinkRate <= 5) return 0.85;
    if (blinkRate <= 10) return 1.0;
    if (blinkRate <= 15) return 0.7;
    if (blinkRate <= 20) return 0.5;
    return 0.3;
  }

  const z = zScore(blinkRate, baseline.blinkRateMean, baseline.blinkRateStdDev);

  // Flow target: -1.0 std below baseline (moderately fewer blinks)
  // Softened from -1.5 to avoid conflating eye strain with flow
  // Use Gaussian centered at -1.0 with width 1.0
  const score = gaussianScore(z, -1.0, 1.0);

  log(`Blink rate: ${blinkRate.toFixed(1)}/min, z=${z.toFixed(2)}, score=${score.toFixed(3)}`);

  return score;
}

/**
 * Calculate gaze stability flow component
 *
 * Research shows gaze stability INCREASES during flow (focused attention).
 * We want z-score above 0 (more stable than baseline).
 */
function calculateGazeStabilityScore(
  gazeStability: number,
  baseline: WorkingBaselineCalibration | null
): number {
  if (!baseline) {
    // Fallback: use absolute thresholds
    if (gazeStability >= 0.8) return 1.0;
    if (gazeStability >= 0.6) return 0.7;
    if (gazeStability >= 0.4) return 0.5;
    return 0.3;
  }

  const z = zScore(gazeStability, baseline.gazeStabilityMean, baseline.gazeStabilityStdDev);

  // Flow target: higher stability = better
  // Use sigmoid: positive z-scores get higher scores
  const score = sigmoidScore(z, 1.0);

  log(`Gaze stability: ${(gazeStability * 100).toFixed(0)}%, z=${z.toFixed(2)}, score=${score.toFixed(3)}`);

  return score;
}

/**
 * Calculate EAR (eye openness) flow component
 *
 * EAR should be relatively stable during flow.
 * Large deviations from baseline suggest fatigue or strain.
 */
function calculateEARScore(
  averageEAR: number,
  baseline: WorkingBaselineCalibration | null
): number {
  if (!baseline) {
    // Fallback: just check it's in normal range
    if (averageEAR >= 0.2 && averageEAR <= 0.35) return 1.0;
    return 0.7;
  }

  const z = zScore(averageEAR, baseline.earMean, baseline.earStdDev);

  // EAR should be close to baseline (not too open, not squinting)
  // Use Gaussian centered at 0 with width 1.5
  const score = gaussianScore(z, 0, 1.5);

  log(`EAR: ${averageEAR.toFixed(3)}, z=${z.toFixed(2)}, score=${score.toFixed(3)}`);

  return score;
}

/**
 * Calculate HRV (RMSSD) flow component
 *
 * During flow, RMSSD tends to be in a moderate "Goldilocks zone" —
 * not too low (stress/anxiety) and not too high (deep relaxation/drowsiness).
 * Optimal is slightly below personal baseline (engaged but calm).
 */
export function calculateHRVScore(
  rmssd: number,
  baseline: WorkingBaselineCalibration | null
): number {
  if (!baseline?.hrvRmssdMean || !baseline?.hrvRmssdStdDev) {
    // No HRV baseline — use absolute thresholds
    // Typical resting RMSSD: 20-80ms, flow zone: ~30-60ms
    if (rmssd >= 25 && rmssd <= 70) return 0.8;
    if (rmssd >= 15 && rmssd <= 90) return 0.6;
    return 0.4;
  }

  const z = zScore(rmssd, baseline.hrvRmssdMean, baseline.hrvRmssdStdDev);

  // Flow target: z = -0.5 (slightly below baseline, engaged but not stressed)
  // Gaussian centered at -0.5 with width 1.2 (fairly broad — HRV is noisy)
  const score = gaussianScore(z, -0.5, 1.2);

  log(`HRV: RMSSD=${rmssd.toFixed(1)}ms, z=${z.toFixed(2)}, score=${score.toFixed(3)}`);

  return score;
}

/**
 * EDA scoring Gaussian width — tunable as real-world data is collected.
 * Width 1.0 means ~68% of score within 1 stdDev of baseline.
 */
const EDA_SCORE_GAUSSIAN_WIDTH = 1.0;

/**
 * Calculate EDA (skin conductance) flow component
 *
 * Skin conductance shows an inverse-U relationship with flow:
 * moderate arousal (near baseline) = flow, low = boredom, high = anxiety.
 * Gaussian centered at z=0 (personal working baseline).
 */
export function calculateEDAScore(
  scl: number,
  baseline: WorkingBaselineCalibration | null
): number {
  if (!baseline?.edaSclMean || !baseline?.edaSclStdDev) {
    // No EDA baseline — use absolute thresholds
    // Typical resting SCL: 1-20 µS, moderate arousal zone: 2-10 µS
    if (scl >= 2 && scl <= 10) return 0.8;
    if (scl >= 1 && scl <= 15) return 0.6;
    return 0.4;
  }

  const z = zScore(scl, baseline.edaSclMean, baseline.edaSclStdDev);

  // Flow target: z = 0 (at personal working baseline)
  // Inverse-U: baseline-level arousal is optimal
  const score = gaussianScore(z, 0, EDA_SCORE_GAUSSIAN_WIDTH);

  log(`EDA: SCL=${scl.toFixed(2)} µS, z=${z.toFixed(2)}, score=${score.toFixed(3)}`);

  return score;
}

/**
 * Calculate stillness flow component
 *
 * High stillness (low movement) indicates focused work, not restlessness.
 * Stillness is already normalized 0-1 by the watch app.
 */
export function calculateStillnessScore(stillness: number): number {
  // Stillness > 0.8 is excellent for flow
  // Linear scaling with slight boost for very still
  const score = Math.min(1.0, stillness * 1.1);

  log(`Stillness: ${(stillness * 100).toFixed(0)}%, score=${score.toFixed(3)}`);

  return score;
}

/**
 * Calculate motion quality multiplier
 *
 * Low stillness (lots of movement) penalizes the flow score.
 * Returns a value between 0.5 (heavy penalty) and 0.95 (minimal penalty).
 */
export function calculateMotionQuality(stillness: number): number {
  // Linear interpolation: stillness 0 → 0.5, stillness 1 → 0.95
  // Formula: 0.5 + (stillness * 0.45)
  const quality = 0.5 + stillness * 0.45;
  return Math.max(0.5, Math.min(0.95, quality));
}

/**
 * Calculate eye-based flow score using calibrated baselines
 *
 * Combines blink rate, gaze stability, and EAR scores
 * with research-based weights.
 */
export function calculateCalibratedEyeFlowScore(
  eyeMetrics: AggregatedEyeMetrics,
  baseline: WorkingBaselineCalibration | null
): number {
  const blinkScore = calculateBlinkRateScore(eyeMetrics.blinkRate, baseline);
  const gazeScore = calculateGazeStabilityScore(eyeMetrics.gazeStability, baseline);
  const earScore = calculateEARScore(eyeMetrics.averageEAR, baseline);

  // Weights based on research:
  // - Gaze stability: most reliable indicator (0.45)
  // - Blink rate: strong indicator but noisier (0.40)
  // - EAR: supplementary (0.15)
  const weightedScore = blinkScore * 0.40 + gazeScore * 0.45 + earScore * 0.15;

  log(`Eye flow: blink=${blinkScore.toFixed(2)}, gaze=${gazeScore.toFixed(2)}, ear=${earScore.toFixed(2)} → ${weightedScore.toFixed(3)}`);

  return Math.max(0, Math.min(1, weightedScore));
}

/**
 * Update flow detector state with new metrics
 *
 * Applies EMA smoothing and handles flow onset detection.
 */
export function updateFlowDetector(
  state: FlowDetectorState,
  rawScore: number,
  timestamp: number
): FlowDetectorState {
  // Apply exponential moving average for smoothing
  const smoothedScore = EMA_ALPHA * rawScore + (1 - EMA_ALPHA) * state.smoothedScore;

  let flowOnsetTime = state.flowOnsetTime;
  let inFlow = state.inFlow;
  let confidence = state.confidence;

  if (smoothedScore >= FLOW_THRESHOLD) {
    // Above threshold
    if (flowOnsetTime === null) {
      flowOnsetTime = timestamp;
    }

    const duration = timestamp - flowOnsetTime;
    inFlow = duration >= FLOW_MIN_DURATION_MS;

    // Confidence ramps up with duration
    if (inFlow) {
      // After minimum duration, confidence increases toward 1.0
      confidence = Math.min(duration / (FLOW_MIN_DURATION_MS * 2.5), 1.0);
    } else {
      // Building up to flow
      confidence = duration / FLOW_MIN_DURATION_MS * 0.5;
    }
  } else {
    // Below threshold
    flowOnsetTime = null;
    inFlow = false;
    // Confidence decays slowly
    confidence = Math.max(0, state.confidence - 0.1);
  }

  return {
    smoothedScore,
    flowOnsetTime,
    inFlow,
    confidence,
    lastUpdate: timestamp,
  };
}

/**
 * Calculate combined flow score from eye and HRV metrics
 *
 * Uses calibrated baselines when available for z-score normalization.
 */
export function calculateCombinedFlow(
  eyeMetrics: AggregatedEyeMetrics,
  hrvMetrics: HRVMetrics | null,
  heartRate: number | null,
  workingBaseline: WorkingBaselineCalibration | null = null,
  edaData: { scl: number } | null = null,
  stillnessData: { stillness: number } | null = null
): CombinedFlowMetrics {
  const timestamp = Date.now();
  const hasWatchData = hrvMetrics !== null;
  // EDA tier only activates when HRV is also present (three-tier requires both)
  const hasEdaData = edaData !== null && hrvMetrics !== null;
  // Stillness tier activates when we have all other sensors
  const hasStillnessData = stillnessData !== null && hasEdaData;

  // Calculate calibrated eye flow score
  const calibratedEyeScore = calculateCalibratedEyeFlowScore(eyeMetrics, workingBaseline);

  let combinedFlowScore: number;

  // Recalculate individual eye component scores (needed for weighted modes)
  const blinkScore = calculateBlinkRateScore(eyeMetrics.blinkRate, workingBaseline);
  const gazeScore = calculateGazeStabilityScore(eyeMetrics.gazeStability, workingBaseline);
  const earScore = calculateEARScore(eyeMetrics.averageEAR, workingBaseline);

  if (hasWatchData && hrvMetrics && hasEdaData && edaData && hasStillnessData && stillnessData) {
    // Four-tier: Eye + HRV + EDA + Stillness
    const hrvScore = calculateHRVScore(hrvMetrics.rmssd, workingBaseline);
    const edaScore = calculateEDAScore(edaData.scl, workingBaseline);
    const stillnessScore = calculateStillnessScore(stillnessData.stillness);

    // Additive weights for four-tier
    combinedFlowScore =
      blinkScore * 0.20 +
      gazeScore * 0.25 +
      earScore * 0.08 +
      hrvScore * 0.17 +
      edaScore * 0.12 +
      stillnessScore * 0.18;

    // Apply motion quality as multiplicative modifier
    const motionQuality = calculateMotionQuality(stillnessData.stillness);
    combinedFlowScore = combinedFlowScore * motionQuality;

    log(`Combined flow (Eye+HRV+EDA+Stillness): blink(${blinkScore.toFixed(3)})*0.20 + gaze(${gazeScore.toFixed(3)})*0.25 + ear(${earScore.toFixed(3)})*0.08 + hrv(${hrvScore.toFixed(3)})*0.17 + eda(${edaScore.toFixed(3)})*0.12 + stillness(${stillnessScore.toFixed(3)})*0.18 * motionQuality(${motionQuality.toFixed(3)}) = ${combinedFlowScore.toFixed(3)}`);
  } else if (hasWatchData && hrvMetrics && hasEdaData && edaData) {
    // Three-tier: Eye + HRV + EDA
    const hrvScore = calculateHRVScore(hrvMetrics.rmssd, workingBaseline);
    const edaScore = calculateEDAScore(edaData.scl, workingBaseline);

    combinedFlowScore =
      blinkScore * 0.25 +
      gazeScore * 0.30 +
      earScore * 0.10 +
      hrvScore * 0.20 +
      edaScore * 0.15;

    log(`Combined flow (Eye+HRV+EDA): blink(${blinkScore.toFixed(3)})*0.25 + gaze(${gazeScore.toFixed(3)})*0.30 + ear(${earScore.toFixed(3)})*0.10 + hrv(${hrvScore.toFixed(3)})*0.20 + eda(${edaScore.toFixed(3)})*0.15 = ${combinedFlowScore.toFixed(3)}`);
  } else if (hasWatchData && hrvMetrics) {
    // Two-tier: Eye + HRV (no EDA)
    const hrvScore = calculateHRVScore(hrvMetrics.rmssd, workingBaseline);

    combinedFlowScore =
      blinkScore * 0.30 +
      gazeScore * 0.35 +
      earScore * 0.10 +
      hrvScore * 0.25;

    log(`Combined flow (Eye+HRV): blink(${blinkScore.toFixed(3)})*0.30 + gaze(${gazeScore.toFixed(3)})*0.35 + ear(${earScore.toFixed(3)})*0.10 + hrv(${hrvScore.toFixed(3)})*0.25 = ${combinedFlowScore.toFixed(3)}`);
  } else {
    // Eye-only mode — unchanged weights (0.40, 0.45, 0.15)
    combinedFlowScore = calibratedEyeScore;

    log(`Eye-only flow: ${combinedFlowScore.toFixed(3)}`);
  }

  // Clamp to 0-1
  combinedFlowScore = Math.max(0, Math.min(1, combinedFlowScore));

  return {
    // Eye metrics
    blinkRate: eyeMetrics.blinkRate,
    gazeStability: eyeMetrics.gazeStability,
    averageEAR: eyeMetrics.averageEAR,
    eyeFlowIndicator: calibratedEyeScore,

    // HRV metrics
    heartRate,
    rmssd: hrvMetrics?.rmssd ?? null,
    sdnn: hrvMetrics?.sdnn ?? null,

    // EDA metrics
    scl: edaData?.scl ?? null,

    // Stillness metrics
    stillness: stillnessData?.stillness ?? null,

    // Combined
    combinedFlowScore,
    hasWatchData,
    hasEdaData,
    hasStillnessData,
    timestamp,
  };
}
