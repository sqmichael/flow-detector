/**
 * HRV Calculator
 *
 * Calculates Heart Rate Variability metrics from Inter-Beat Interval (IBI) data.
 * Uses a 60-second sliding window for calculations.
 */

import { DEFAULT_HRV_CONFIG, type HRVConfig, type HRVMetrics, type IBIData } from "./types";

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[HRV Calculator]", ...args);
  }
}

/**
 * Calculate RMSSD (Root Mean Square of Successive Differences)
 *
 * RMSSD is a time-domain HRV metric that reflects parasympathetic activity.
 * Higher RMSSD generally indicates better recovery and relaxation.
 *
 * @param ibiValues Array of IBI values in milliseconds
 * @returns RMSSD value in milliseconds, or 0 if insufficient data
 */
export function calculateRMSSD(ibiValues: number[]): number {
  if (ibiValues.length < 2) {
    log("RMSSD: Insufficient data, need at least 2 IBI values");
    return 0;
  }

  // Calculate successive differences
  const differences: number[] = [];
  for (let i = 1; i < ibiValues.length; i++) {
    differences.push(ibiValues[i] - ibiValues[i - 1]);
  }

  // Calculate mean of squared differences
  const squaredDiffs = differences.map((d) => d * d);
  const meanSquared = squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length;

  // Return root mean square
  const rmssd = Math.sqrt(meanSquared);

  log(`RMSSD calculated: ${rmssd.toFixed(2)}ms from ${ibiValues.length} IBI values`);

  return rmssd;
}

/**
 * Calculate SDNN (Standard Deviation of NN intervals)
 *
 * SDNN reflects overall HRV and is influenced by both sympathetic
 * and parasympathetic activity. Higher SDNN indicates greater variability.
 *
 * @param ibiValues Array of IBI values in milliseconds
 * @returns SDNN value in milliseconds, or 0 if insufficient data
 */
export function calculateSDNN(ibiValues: number[]): number {
  if (ibiValues.length < 2) {
    log("SDNN: Insufficient data, need at least 2 IBI values");
    return 0;
  }

  // Calculate mean
  const mean = ibiValues.reduce((sum, val) => sum + val, 0) / ibiValues.length;

  // Calculate variance
  const squaredDeviations = ibiValues.map((val) => Math.pow(val - mean, 2));
  const variance = squaredDeviations.reduce((sum, val) => sum + val, 0) / ibiValues.length;

  // Return standard deviation
  const sdnn = Math.sqrt(variance);

  log(`SDNN calculated: ${sdnn.toFixed(2)}ms from ${ibiValues.length} IBI values`);

  return sdnn;
}

/**
 * HRV Calculator class that maintains a sliding window of IBI data
 */
export class HRVCalculator {
  private ibiHistory: IBIData[] = [];
  private config: HRVConfig;

  constructor(config: Partial<HRVConfig> = {}) {
    this.config = { ...DEFAULT_HRV_CONFIG, ...config };
    log("HRV Calculator initialized with config:", this.config);
  }

  /**
   * Add a new IBI value to the history
   *
   * @param ibi Inter-beat interval in milliseconds
   * @param timestamp Unix timestamp in milliseconds
   * @returns true if the IBI was accepted, false if filtered out
   */
  addIBI(ibi: number, timestamp: number = Date.now()): boolean {
    // Filter out artifact values
    if (ibi < this.config.minIBI || ibi > this.config.maxIBI) {
      log(`IBI filtered out: ${ibi}ms (outside range ${this.config.minIBI}-${this.config.maxIBI})`);
      return false;
    }

    this.ibiHistory.push({ ibi, timestamp });

    // Remove old entries outside the window
    const windowStart = timestamp - this.config.windowSizeMs;
    this.ibiHistory = this.ibiHistory.filter((entry) => entry.timestamp >= windowStart);

    log(`IBI added: ${ibi}ms, history size: ${this.ibiHistory.length}`);

    return true;
  }

  /**
   * Calculate current HRV metrics from the sliding window
   *
   * @returns HRV metrics or null if insufficient data
   */
  calculate(): HRVMetrics | null {
    if (this.ibiHistory.length < this.config.minSamples) {
      log(
        `Insufficient IBI samples: ${this.ibiHistory.length}/${this.config.minSamples} required`
      );
      return null;
    }

    const ibiValues = this.ibiHistory.map((entry) => entry.ibi);

    const rmssd = calculateRMSSD(ibiValues);
    const sdnn = calculateSDNN(ibiValues);

    const metrics: HRVMetrics = {
      rmssd,
      sdnn,
      sampleCount: ibiValues.length,
      timestamp: Date.now(),
    };

    log("HRV metrics calculated:", metrics);

    return metrics;
  }

  /**
   * Get the current number of IBI samples in the window
   */
  getSampleCount(): number {
    return this.ibiHistory.length;
  }

  /**
   * Clear all IBI history
   */
  reset(): void {
    this.ibiHistory = [];
    log("HRV Calculator reset");
  }

  /**
   * Get the raw IBI values (for debugging)
   */
  getIBIValues(): number[] {
    return this.ibiHistory.map((entry) => entry.ibi);
  }
}
