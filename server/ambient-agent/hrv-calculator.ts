/**
 * HRV Calculator (Server-side copy)
 *
 * Calculates Heart Rate Variability metrics from Inter-Beat Interval (IBI) data.
 * Uses a 60-second sliding window for calculations.
 *
 * This is a copy of src/lib/biometrics/hrv-calculator.ts for server use,
 * avoiding browser-only type dependencies.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface IBIData {
  ibi: number;
  timestamp: number;
}

export interface HRVMetrics {
  rmssd: number;
  sdnn: number;
  sampleCount: number;
  timestamp: number;
}

export interface HRVConfig {
  windowSizeMs: number;
  minSamples: number;
  maxIBI: number;
  minIBI: number;
}

const DEFAULT_HRV_CONFIG: HRVConfig = {
  windowSizeMs: 60000,
  minSamples: 10,
  maxIBI: 2000,
  minIBI: 300,
};

// ── Calculator ──────────────────────────────────────────────────────

/**
 * Calculate RMSSD (Root Mean Square of Successive Differences)
 */
export function calculateRMSSD(ibiValues: number[]): number {
  if (ibiValues.length < 2) {
    return 0;
  }

  const differences: number[] = [];
  for (let i = 1; i < ibiValues.length; i++) {
    differences.push(ibiValues[i] - ibiValues[i - 1]);
  }

  const squaredDiffs = differences.map((d) => d * d);
  const meanSquared =
    squaredDiffs.reduce((sum, val) => sum + val, 0) / squaredDiffs.length;

  return Math.sqrt(meanSquared);
}

/**
 * Calculate SDNN (Standard Deviation of NN intervals)
 */
export function calculateSDNN(ibiValues: number[]): number {
  if (ibiValues.length < 2) {
    return 0;
  }

  const mean = ibiValues.reduce((sum, val) => sum + val, 0) / ibiValues.length;
  const squaredDeviations = ibiValues.map((val) => Math.pow(val - mean, 2));
  const variance =
    squaredDeviations.reduce((sum, val) => sum + val, 0) / ibiValues.length;

  return Math.sqrt(variance);
}

/**
 * HRV Calculator class that maintains a sliding window of IBI data
 */
export class HRVCalculator {
  private ibiHistory: IBIData[] = [];
  private config: HRVConfig;

  constructor(config: Partial<HRVConfig> = {}) {
    this.config = { ...DEFAULT_HRV_CONFIG, ...config };
  }

  addIBI(ibi: number, timestamp: number = Date.now()): boolean {
    if (ibi < this.config.minIBI || ibi > this.config.maxIBI) {
      return false;
    }

    this.ibiHistory.push({ ibi, timestamp });

    const windowStart = timestamp - this.config.windowSizeMs;
    this.ibiHistory = this.ibiHistory.filter(
      (entry) => entry.timestamp >= windowStart
    );

    return true;
  }

  calculate(): HRVMetrics | null {
    if (this.ibiHistory.length < this.config.minSamples) {
      return null;
    }

    const ibiValues = this.ibiHistory.map((entry) => entry.ibi);

    const rmssd = calculateRMSSD(ibiValues);
    const sdnn = calculateSDNN(ibiValues);

    return {
      rmssd,
      sdnn,
      sampleCount: ibiValues.length,
      timestamp: Date.now(),
    };
  }

  getSampleCount(): number {
    return this.ibiHistory.length;
  }

  reset(): void {
    this.ibiHistory = [];
  }

  getIBIValues(): number[] {
    return this.ibiHistory.map((entry) => entry.ibi);
  }
}
