/**
 * Ambient Agent Detectors
 *
 * Detection functions for flow, stress, and recovery patterns
 * based on HR/HRV sensor data.
 */

import type {
  FlowDetectionConfig,
  StressDetectionConfig,
  EveningReflectionConfig,
  PersonalBaseline,
} from "./types";

// ── Sensor History Types ────────────────────────────────────────────

export interface SensorSample {
  hr: number;
  timestamp: number;
}

export interface HRVSample {
  rmssd: number;
  timestamp: number;
}

// ── Flow Detection (Behavior A) ─────────────────────────────────────

/**
 * Calculate HR variance over a time window
 * Returns the standard deviation of HR values
 */
export function calculateHRVariance(samples: SensorSample[]): number {
  if (samples.length < 2) return Infinity;

  const hrValues = samples.map((s) => s.hr);
  const mean = hrValues.reduce((a, b) => a + b, 0) / hrValues.length;
  const squaredDiffs = hrValues.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / hrValues.length;

  return Math.sqrt(variance);
}

/**
 * Check if HR has been stable (low variance) for the detection window
 */
export function isHRStable(
  samples: SensorSample[],
  config: FlowDetectionConfig,
  windowMs: number = 30 * 60 * 1000 // 30 minutes
): { isStable: boolean; variance: number; durationMinutes: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Get samples within window
  const windowSamples = samples.filter((s) => s.timestamp >= windowStart);

  if (windowSamples.length < 10) {
    return { isStable: false, variance: Infinity, durationMinutes: 0 };
  }

  const variance = calculateHRVariance(windowSamples);
  const isStable = variance <= config.hrStabilityThreshold;

  // Calculate how long stability has been maintained
  let stableDurationMs = 0;
  if (isStable) {
    // Find the earliest sample in the stable window
    const firstSample = windowSamples[0];
    stableDurationMs = now - firstSample.timestamp;
  }

  return {
    isStable,
    variance,
    durationMinutes: Math.floor(stableDurationMs / (60 * 1000)),
  };
}

/**
 * Detect flow state based on stillness and HR stability
 */
export function detectFlowState(
  hrSamples: SensorSample[],
  config: FlowDetectionConfig
): {
  shouldEnterFlowMode: boolean;
  stableMinutes: number;
  hrVariance: number;
} {
  const windowMs = config.stillnessMinutes * 60 * 1000;
  const { isStable, variance, durationMinutes } = isHRStable(
    hrSamples,
    config,
    windowMs
  );

  return {
    shouldEnterFlowMode: isStable && durationMinutes >= config.stillnessMinutes,
    stableMinutes: durationMinutes,
    hrVariance: variance,
  };
}

// ── Stress Detection (Behavior B) ───────────────────────────────────

/**
 * Check if HR is elevated above baseline
 */
export function isHRElevated(
  currentHR: number,
  baseline: PersonalBaseline,
  config: StressDetectionConfig
): boolean {
  return currentHR > baseline.restingHR + config.hrElevatedAboveBaseline;
}

/**
 * Check if HRV is suppressed below baseline
 */
export function isHRVSuppressed(
  currentHRV: number,
  baseline: PersonalBaseline,
  config: StressDetectionConfig
): boolean {
  const threshold = baseline.baselineHRV * config.hrvSuppressedBelowBaseline;
  return currentHRV < threshold;
}

/**
 * Detect sustained stress pattern
 */
export function detectStressPattern(
  currentHR: number | null,
  currentHRV: number | null,
  baseline: PersonalBaseline | null,
  elevationStartedAt: number | null,
  config: StressDetectionConfig
): {
  isStressed: boolean;
  elevatedMinutes: number;
  shouldTriggerCheckin: boolean;
} {
  // Need baseline and current values
  if (!baseline || currentHR === null || currentHRV === null) {
    return {
      isStressed: false,
      elevatedMinutes: 0,
      shouldTriggerCheckin: false,
    };
  }

  const hrElevated = isHRElevated(currentHR, baseline, config);
  const hrvSuppressed = isHRVSuppressed(currentHRV, baseline, config);
  const isStressed = hrElevated && hrvSuppressed;

  // Calculate duration
  let elevatedMinutes = 0;
  if (isStressed && elevationStartedAt) {
    elevatedMinutes = Math.floor((Date.now() - elevationStartedAt) / (60 * 1000));
  }

  const shouldTriggerCheckin =
    isStressed && elevatedMinutes >= config.durationMinutes;

  return {
    isStressed,
    elevatedMinutes,
    shouldTriggerCheckin,
  };
}

// ── Recovery Detection (Behavior C) ─────────────────────────────────

/**
 * Check if currently in the evening reflection window
 * @param timezoneOffset - Hours offset from UTC (e.g., 8 for Singapore)
 */
export function isInEveningWindow(
  config: EveningReflectionConfig,
  timezoneOffset: number = 0
): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const localHour = ((utcHour + timezoneOffset) % 24 + 24) % 24;
  return localHour >= config.windowStartHour && localHour < config.windowEndHour;
}

/**
 * Detect recovery state (HRV up, HR down from baseline)
 */
export function detectRecoveryState(
  currentHR: number | null,
  currentHRV: number | null,
  baseline: PersonalBaseline | null,
  config: EveningReflectionConfig
): { inRecovery: boolean; reason: string } {
  if (!baseline || currentHR === null || currentHRV === null) {
    return { inRecovery: false, reason: "Missing data" };
  }

  const { recoveryIndicators } = config;

  const hrvAboveBaseline =
    currentHRV > baseline.baselineHRV * recoveryIndicators.hrvAboveBaseline;
  const hrBelowBaseline =
    currentHR < baseline.restingHR - recoveryIndicators.hrBelowBaseline;

  if (hrvAboveBaseline && hrBelowBaseline) {
    return {
      inRecovery: true,
      reason: `HRV ${Math.round(currentHRV)}ms (>${Math.round(baseline.baselineHRV * recoveryIndicators.hrvAboveBaseline)}ms), HR ${currentHR}bpm (<${baseline.restingHR - recoveryIndicators.hrBelowBaseline}bpm)`,
    };
  }

  return { inRecovery: false, reason: "Not in recovery state" };
}

/**
 * Determine if evening reflection should trigger
 */
export function shouldTriggerEveningReflection(
  currentHR: number | null,
  currentHRV: number | null,
  baseline: PersonalBaseline | null,
  reflectionOfferedToday: boolean,
  config: EveningReflectionConfig,
  timezoneOffset: number = 0
): { shouldTrigger: boolean; reason: string } {
  if (reflectionOfferedToday) {
    return { shouldTrigger: false, reason: "Already offered today" };
  }

  if (!isInEveningWindow(config, timezoneOffset)) {
    return { shouldTrigger: false, reason: "Outside evening window" };
  }

  // Only trigger on actual recovery state detection - no time fallbacks
  const recovery = detectRecoveryState(currentHR, currentHRV, baseline, config);
  if (recovery.inRecovery) {
    return {
      shouldTrigger: true,
      reason: `Recovery detected: ${recovery.reason}`,
    };
  }

  return { shouldTrigger: false, reason: "Waiting for recovery state" };
}

// ── Low Energy Detection (Silent Logging Only) ──────────────────────

export interface LowEnergyConfig {
  hrThreshold: number; // HR below this suggests low energy (default: 60)
  hrvLowThreshold: number; // HRV below this (not crashed, just low)
  hrvHighThreshold: number; // HRV above this = probably fine
  edaFlatThreshold: number; // EDA below this = flat/no arousal
  activeHoursStart: number; // Start of "should be awake" hours (default: 8)
  activeHoursEnd: number; // End of active hours (default: 18)
}

export const DEFAULT_LOW_ENERGY_CONFIG: LowEnergyConfig = {
  hrThreshold: 60,
  hrvLowThreshold: 50,
  hrvHighThreshold: 100,
  edaFlatThreshold: 0.5,
  activeHoursStart: 8,
  activeHoursEnd: 18,
};

export interface LowEnergyState {
  isLowEnergy: boolean;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  metrics: {
    hr: number | null;
    hrv: number | null;
    eda: number | null;
    localHour: number;
  };
}

/**
 * Detect low energy state (for logging only, not intervention)
 *
 * Low energy pattern:
 * - HR at resting levels during active hours
 * - HRV moderate-low (not crashed like stress, just flat)
 * - EDA flat (no arousal)
 */
export function detectLowEnergy(
  currentHR: number | null,
  currentHRV: number | null,
  currentEDA: number | null,
  timezoneOffset: number,
  config: LowEnergyConfig = DEFAULT_LOW_ENERGY_CONFIG
): LowEnergyState {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const localHour = ((utcHour + timezoneOffset) % 24 + 24) % 24;

  const metrics = {
    hr: currentHR,
    hrv: currentHRV,
    eda: currentEDA,
    localHour,
  };

  // Outside active hours - don't flag as "low energy"
  if (localHour < config.activeHoursStart || localHour >= config.activeHoursEnd) {
    return {
      isLowEnergy: false,
      confidence: "low",
      reasons: ["Outside active hours"],
      metrics,
    };
  }

  const reasons: string[] = [];
  let score = 0;

  // Check HR
  if (currentHR !== null && currentHR < config.hrThreshold) {
    reasons.push(`HR ${currentHR} < ${config.hrThreshold} (resting level)`);
    score += 1;
  }

  // Check HRV - looking for moderate-low, not crashed
  if (currentHRV !== null) {
    if (currentHRV < config.hrvLowThreshold) {
      reasons.push(`HRV ${Math.round(currentHRV)}ms < ${config.hrvLowThreshold}ms (low)`);
      score += 1;
    } else if (currentHRV < config.hrvHighThreshold) {
      reasons.push(`HRV ${Math.round(currentHRV)}ms moderate`);
      score += 0.5;
    }
  }

  // Check EDA
  if (currentEDA !== null && currentEDA < config.edaFlatThreshold) {
    reasons.push(`EDA ${currentEDA.toFixed(1)}µS flat (no arousal)`);
    score += 1;
  }

  // Determine confidence
  let confidence: "low" | "medium" | "high" = "low";
  if (score >= 2.5) confidence = "high";
  else if (score >= 1.5) confidence = "medium";

  const isLowEnergy = score >= 1.5;

  return {
    isLowEnergy,
    confidence,
    reasons,
    metrics,
  };
}

// ── Baseline Estimation ─────────────────────────────────────────────

/**
 * Estimate baseline from recent sensor data
 * Uses a rolling average of low-activity periods
 */
export function estimateBaseline(
  hrSamples: SensorSample[],
  hrvSamples: HRVSample[],
  windowMinutes: number = 10
): PersonalBaseline | null {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const windowStart = now - windowMs;

  const recentHR = hrSamples.filter((s) => s.timestamp >= windowStart);
  const recentHRV = hrvSamples.filter((s) => s.timestamp >= windowStart);

  if (recentHR.length < 5 || recentHRV.length < 3) {
    return null;
  }

  // Use median for HR (more robust to outliers)
  const sortedHR = recentHR.map((s) => s.hr).sort((a, b) => a - b);
  const medianHR = sortedHR[Math.floor(sortedHR.length / 2)];

  // Use mean for HRV
  const meanHRV =
    recentHRV.map((s) => s.rmssd).reduce((a, b) => a + b, 0) / recentHRV.length;

  return {
    restingHR: medianHR,
    baselineHRV: meanHRV,
    updatedAt: now,
  };
}
