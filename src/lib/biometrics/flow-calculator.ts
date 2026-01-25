/**
 * Combined Flow Calculator
 *
 * Calculates a combined flow score from eye tracking and HRV metrics.
 *
 * Formula: Flow = (HRV_normalized × GazeStability) - BlinkPenalty
 *
 * When watch is not connected, falls back to eye-only flow score.
 */

import type { AggregatedEyeMetrics } from "../mediapipe/types";
import type { CombinedFlowMetrics, HRVMetrics } from "./types";

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[Flow Calculator]", ...args);
  }
}

/**
 * Configuration for flow calculation
 */
interface FlowConfig {
  /** Optimal RMSSD value in ms (typical range 20-100ms, higher = calmer) */
  optimalRMSSD: number;
  /** Minimum RMSSD to consider (below this = stressed) */
  minRMSSD: number;
  /** Maximum RMSSD to cap at (above this = very relaxed, may be drowsy) */
  maxRMSSD: number;
  /** Optimal blink rate per minute for flow state */
  optimalBlinkRate: number;
  /** Maximum penalty for excessive blinking */
  maxBlinkPenalty: number;
  /** Weight for HRV component when watch connected (0-1) */
  hrvWeight: number;
  /** Weight for eye metrics when watch connected (0-1) */
  eyeWeight: number;
}

const DEFAULT_FLOW_CONFIG: FlowConfig = {
  optimalRMSSD: 50, // 50ms is typically good for focused relaxation
  minRMSSD: 15, // Below this suggests stress
  maxRMSSD: 100, // Above this might suggest drowsiness
  optimalBlinkRate: 10, // About 10 blinks/min is typical for focused work
  maxBlinkPenalty: 0.3, // Maximum penalty from blinking
  hrvWeight: 0.4, // 40% weight to HRV
  eyeWeight: 0.6, // 60% weight to eye metrics
};

/**
 * Normalize RMSSD to a 0-1 scale
 *
 * Higher RMSSD generally indicates more parasympathetic activity (calmer state).
 * We want to reward moderate HRV as it indicates a calm but engaged state.
 *
 * @param rmssd RMSSD value in milliseconds
 * @param config Flow configuration
 * @returns Normalized value between 0 and 1
 */
export function normalizeRMSSD(
  rmssd: number,
  config: FlowConfig = DEFAULT_FLOW_CONFIG
): number {
  if (rmssd <= config.minRMSSD) {
    // Very low HRV - stressed
    return rmssd / config.minRMSSD * 0.3;
  }

  if (rmssd >= config.maxRMSSD) {
    // Very high HRV - possibly drowsy, slight penalty
    return 0.8;
  }

  // Linear interpolation in the optimal range
  const range = config.maxRMSSD - config.minRMSSD;
  const normalized = (rmssd - config.minRMSSD) / range;

  // Apply a curve that peaks around the optimal value
  const optimal = (config.optimalRMSSD - config.minRMSSD) / range;
  const distance = Math.abs(normalized - optimal);
  const score = 1 - (distance * 0.4); // Max 40% penalty for being far from optimal

  log(`RMSSD ${rmssd}ms normalized to ${score.toFixed(3)}`);

  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate blink penalty
 *
 * Too few blinks might indicate strain, too many might indicate fatigue.
 *
 * @param blinkRate Blinks per minute
 * @param config Flow configuration
 * @returns Penalty value between 0 and maxBlinkPenalty
 */
export function calculateBlinkPenalty(
  blinkRate: number,
  config: FlowConfig = DEFAULT_FLOW_CONFIG
): number {
  const deviation = Math.abs(blinkRate - config.optimalBlinkRate);

  // No penalty if within 5 blinks/min of optimal
  if (deviation <= 5) {
    return 0;
  }

  // Gradual penalty for larger deviations
  const penalty = Math.min(
    config.maxBlinkPenalty,
    (deviation - 5) / 20 * config.maxBlinkPenalty
  );

  log(`Blink rate ${blinkRate}/min, penalty: ${penalty.toFixed(3)}`);

  return penalty;
}

/**
 * Calculate combined flow score from eye and HRV metrics
 *
 * @param eyeMetrics Eye tracking metrics (required)
 * @param hrvMetrics HRV metrics (optional, from watch)
 * @param heartRate Current heart rate (optional)
 * @param config Flow configuration
 * @returns Combined flow metrics
 */
export function calculateCombinedFlow(
  eyeMetrics: AggregatedEyeMetrics,
  hrvMetrics: HRVMetrics | null,
  heartRate: number | null,
  config: FlowConfig = DEFAULT_FLOW_CONFIG
): CombinedFlowMetrics {
  const timestamp = Date.now();
  const hasWatchData = hrvMetrics !== null;

  // Calculate blink penalty
  const blinkPenalty = calculateBlinkPenalty(eyeMetrics.blinkRate, config);

  let combinedFlowScore: number;

  if (hasWatchData && hrvMetrics) {
    // Combined mode: merge HRV and eye metrics
    const hrvNormalized = normalizeRMSSD(hrvMetrics.rmssd, config);

    // Combined formula: (HRV_normalized × GazeStability) - BlinkPenalty
    // Weight the HRV and eye components
    const hrvComponent = hrvNormalized * config.hrvWeight;
    const eyeComponent = eyeMetrics.gazeStability * config.eyeWeight;

    combinedFlowScore = hrvComponent + eyeComponent - blinkPenalty;

    log(
      `Combined flow: HRV(${hrvComponent.toFixed(3)}) + Eye(${eyeComponent.toFixed(3)}) - Blink(${blinkPenalty.toFixed(3)}) = ${combinedFlowScore.toFixed(3)}`
    );
  } else {
    // Eye-only mode: use eye metrics alone with adjusted penalty
    combinedFlowScore = eyeMetrics.eyeFlowIndicator;

    log(`Eye-only flow: ${combinedFlowScore.toFixed(3)}`);
  }

  // Clamp to 0-1
  combinedFlowScore = Math.max(0, Math.min(1, combinedFlowScore));

  return {
    // Eye metrics
    blinkRate: eyeMetrics.blinkRate,
    gazeStability: eyeMetrics.gazeStability,
    averageEAR: eyeMetrics.averageEAR,
    eyeFlowIndicator: eyeMetrics.eyeFlowIndicator,

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
