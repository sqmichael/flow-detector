/**
 * Combined Flow Calculator
 *
 * Calculates a combined flow score from eye tracking and HRV metrics
 * using z-score normalization against personal baselines.
 *
 * Research shows flow is characterized by:
 * - Blink rate BELOW personal baseline (visual absorption)
 * - Gaze stability ABOVE personal baseline (focused attention)
 * - HRV in moderate range (engaged but calm)
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

  // Flow target: -1.5 std below baseline (significantly fewer blinks)
  // Use Gaussian centered at -1.5 with width 1.0
  const score = gaussianScore(z, -1.5, 1.0);

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
  workingBaseline: WorkingBaselineCalibration | null = null
): CombinedFlowMetrics {
  const timestamp = Date.now();
  const hasWatchData = hrvMetrics !== null;

  // Calculate calibrated eye flow score
  const calibratedEyeScore = calculateCalibratedEyeFlowScore(eyeMetrics, workingBaseline);

  let combinedFlowScore: number;

  if (hasWatchData && hrvMetrics) {
    // TODO: Add HRV scoring when watch provides IBI data
    // For now, just use eye metrics with slight weight adjustment
    const hrvComponent = 0; // Placeholder until we have proper HRV
    const eyeComponent = calibratedEyeScore;

    // When watch connected but no HRV, still use eye metrics
    combinedFlowScore = eyeComponent;

    log(`Combined flow: HRV(${hrvComponent.toFixed(3)}) + Eye(${eyeComponent.toFixed(3)}) = ${combinedFlowScore.toFixed(3)}`);
  } else {
    // Eye-only mode
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
    eyeFlowIndicator: calibratedEyeScore, // Now uses calibrated score

    // HRV metrics
    heartRate,
    rmssd: hrvMetrics?.rmssd ?? null,
    sdnn: hrvMetrics?.sdnn ?? null,

    // Combined
    combinedFlowScore,
    hasWatchData,
    timestamp,
  };
}
