/**
 * Calibration Processor
 *
 * Pure functions for processing collected samples into calibration data.
 * These functions have no side effects and are easily testable.
 */

import type {
  EARCalibration,
  GazeCalibration,
  BlinkTimingCalibration,
  WorkingBaselineCalibration,
  WorkingBaselineWindow,
  CalibrationData,
} from "./types";

/**
 * Calculate mean of an array of numbers
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation of an array of numbers
 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squaredDiffs));
}

/**
 * Calculate EAR calibration from baseline samples
 *
 * @param earSamples - Array of EAR values collected during baseline step
 * @returns Partial EAR calibration (closedEyeEAR and blinkThreshold set later)
 */
export function calculateEARBaseline(
  earSamples: number[]
): Pick<EARCalibration, "openEyeEAR" | "openEyeEARStdDev"> {
  // Filter out any outliers (values that are too low, likely partial blinks)
  const threshold = 0.15; // Below this is definitely not open eyes
  const validSamples = earSamples.filter((ear) => ear > threshold);

  if (validSamples.length === 0) {
    console.warn("[Calibration] No valid EAR samples, using defaults");
    return {
      openEyeEAR: 0.28,
      openEyeEARStdDev: 0.03,
    };
  }

  return {
    openEyeEAR: mean(validSamples),
    openEyeEARStdDev: stdDev(validSamples),
  };
}

/**
 * Calculate blink threshold from open eye EAR and blink minimum EARs
 *
 * The threshold is set at 40% between closed and open EAR.
 * This biases toward the closed value to reduce false positives.
 *
 * @param openEyeEAR - Average EAR when eyes are open
 * @param blinkMinEARs - Array of minimum EAR values during each blink
 * @returns Complete EAR calibration
 */
export function calculateBlinkThreshold(
  openEyeEAR: number,
  openEyeEARStdDev: number,
  blinkMinEARs: number[]
): EARCalibration {
  if (blinkMinEARs.length === 0) {
    console.warn("[Calibration] No blink samples, using default threshold");
    return {
      openEyeEAR,
      closedEyeEAR: 0.12,
      blinkThreshold: 0.18,
      openEyeEARStdDev,
    };
  }

  const closedEyeEAR = mean(blinkMinEARs);

  // Threshold at 40% from closed to open
  // Example: open=0.30, closed=0.10, threshold=0.10 + 0.4*(0.30-0.10) = 0.18
  const blinkThreshold = closedEyeEAR + 0.4 * (openEyeEAR - closedEyeEAR);

  console.log("[Calibration] Calculated blink threshold:", {
    openEyeEAR: openEyeEAR.toFixed(3),
    closedEyeEAR: closedEyeEAR.toFixed(3),
    blinkThreshold: blinkThreshold.toFixed(3),
  });

  return {
    openEyeEAR,
    closedEyeEAR,
    blinkThreshold,
    openEyeEARStdDev,
  };
}

/**
 * Calculate gaze calibration from gaze center samples
 *
 * @param gazeSamples - Array of gaze vectors collected during gaze-center step
 * @returns Gaze calibration with center and variance
 */
export function calculateGazeCalibration(
  gazeSamples: { x: number; y: number }[]
): GazeCalibration {
  if (gazeSamples.length === 0) {
    console.warn("[Calibration] No gaze samples, using origin as center");
    return {
      center: { x: 0, y: 0 },
      centerStdDev: { x: 0.1, y: 0.1 },
    };
  }

  const xValues = gazeSamples.map((g) => g.x);
  const yValues = gazeSamples.map((g) => g.y);

  const center = {
    x: mean(xValues),
    y: mean(yValues),
  };

  const centerStdDev = {
    x: stdDev(xValues),
    y: stdDev(yValues),
  };

  console.log("[Calibration] Calculated gaze center:", {
    center: `(${center.x.toFixed(3)}, ${center.y.toFixed(3)})`,
    stdDev: `(${centerStdDev.x.toFixed(3)}, ${centerStdDev.y.toFixed(3)})`,
  });

  return { center, centerStdDev };
}

/**
 * Calculate blink timing calibration from blink durations
 *
 * @param blinkDurations - Array of blink durations in milliseconds
 * @returns Blink timing calibration
 */
export function calculateBlinkTimingCalibration(
  blinkDurations: number[]
): BlinkTimingCalibration {
  if (blinkDurations.length === 0) {
    console.warn("[Calibration] No blink durations, using defaults");
    return {
      averageBlinkDuration: 150,
      minBlinkDuration: 50,
      maxBlinkDuration: 400,
    };
  }

  const sorted = [...blinkDurations].sort((a, b) => a - b);

  const result = {
    averageBlinkDuration: mean(blinkDurations),
    minBlinkDuration: sorted[0],
    maxBlinkDuration: sorted[sorted.length - 1],
  };

  console.log("[Calibration] Calculated blink timing:", {
    avg: `${result.averageBlinkDuration.toFixed(0)}ms`,
    range: `${result.minBlinkDuration}-${result.maxBlinkDuration}ms`,
  });

  return result;
}

/**
 * Calculate working baseline calibration from 5-second window samples
 *
 * @param windows - Array of working baseline windows collected during normal activity
 * @returns Working baseline calibration data
 */
export function calculateWorkingBaselineCalibration(
  windows: WorkingBaselineWindow[]
): WorkingBaselineCalibration {
  if (windows.length === 0) {
    console.warn("[Calibration] No working baseline windows, using defaults");
    return {
      blinkRateMean: 15,
      blinkRateStdDev: 5,
      gazeStabilityMean: 0.6,
      gazeStabilityStdDev: 0.15,
      earMean: 0.28,
      earStdDev: 0.03,
      captureDurationMs: 0,
      windowCount: 0,
    };
  }

  const blinkRates = windows.map((w) => w.blinkRate);
  const gazeStabilities = windows.map((w) => w.gazeStability);
  const ears = windows.map((w) => w.averageEAR);

  const firstTimestamp = windows[0].timestamp;
  const lastTimestamp = windows[windows.length - 1].timestamp;
  const captureDurationMs = lastTimestamp - firstTimestamp;

  const result = {
    blinkRateMean: mean(blinkRates),
    blinkRateStdDev: Math.max(stdDev(blinkRates), 1), // Minimum 1 to avoid division by zero
    gazeStabilityMean: mean(gazeStabilities),
    gazeStabilityStdDev: Math.max(stdDev(gazeStabilities), 0.05), // Minimum to avoid division by zero
    earMean: mean(ears),
    earStdDev: Math.max(stdDev(ears), 0.01),
    captureDurationMs,
    windowCount: windows.length,
  };

  console.log("[Calibration] Calculated working baseline:", {
    blinkRate: `${result.blinkRateMean.toFixed(1)} ± ${result.blinkRateStdDev.toFixed(1)}/min`,
    gazeStability: `${(result.gazeStabilityMean * 100).toFixed(0)} ± ${(result.gazeStabilityStdDev * 100).toFixed(0)}%`,
    ear: `${result.earMean.toFixed(3)} ± ${result.earStdDev.toFixed(3)}`,
    windows: result.windowCount,
  });

  return result;
}

/**
 * Build complete calibration data from all collected samples
 *
 * @param earSamples - EAR samples from baseline step
 * @param blinkEvents - Blink events from blink step
 * @param gazeSamples - Gaze samples from gaze-center step
 * @param workingBaselineWindows - Working baseline windows from working-baseline step
 * @returns Complete calibration data ready for storage
 */
export function buildCalibrationData(
  earSamples: number[],
  blinkEvents: { earMin: number; duration: number }[],
  gazeSamples: { x: number; y: number }[],
  workingBaselineWindows: WorkingBaselineWindow[] = []
): CalibrationData {
  // Calculate EAR baseline
  const earBaseline = calculateEARBaseline(earSamples);

  // Calculate blink threshold using baseline and blink minimums
  const blinkMinEARs = blinkEvents.map((e) => e.earMin);
  const ear = calculateBlinkThreshold(
    earBaseline.openEyeEAR,
    earBaseline.openEyeEARStdDev,
    blinkMinEARs
  );

  // Calculate gaze calibration
  const gaze = calculateGazeCalibration(gazeSamples);

  // Calculate blink timing
  const blinkDurations = blinkEvents.map((e) => e.duration);
  const blinkTiming = calculateBlinkTimingCalibration(blinkDurations);

  // Calculate working baseline
  const workingBaseline = calculateWorkingBaselineCalibration(workingBaselineWindows);

  const totalSamples =
    earSamples.length + blinkEvents.length + gazeSamples.length + workingBaselineWindows.length;

  return {
    version: 2,
    calibratedAt: Date.now(),
    ear,
    gaze,
    blinkTiming,
    workingBaseline,
    sampleCount: totalSamples,
  };
}
