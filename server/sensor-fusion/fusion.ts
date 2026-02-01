/**
 * Sensor Fusion Logic
 *
 * Time alignment for correlating eye tracking (5s windows) with
 * watch data (30s batches). Creates fused windows for analysis.
 */

import {
  getDatabase,
  getEyeMetricsInRange,
  getWatchBatchInRange,
  insertFusedWindow,
  getFusedWindowsInRange,
} from "./database";
import type {
  EyeMetricsRow,
  WatchBatchRow,
  FusedWindowRow,
  FusedWindowInsert,
} from "./types";

const FUSION_WINDOW_MS = 30_000; // 30 seconds
const EYE_WINDOW_MS = 5_000; // 5 seconds

/**
 * Aggregate eye metrics from multiple 5s windows into a single summary
 */
function aggregateEyeMetrics(windows: EyeMetricsRow[]): {
  blink_rate: number | null;
  gaze_stability: number | null;
  average_ear: number | null;
  eye_flow_indicator: number | null;
  window_count: number;
  quality: number;
} {
  if (windows.length === 0) {
    return {
      blink_rate: null,
      gaze_stability: null,
      average_ear: null,
      eye_flow_indicator: null,
      window_count: 0,
      quality: 0,
    };
  }

  // Weighted average by frame count for better quality estimation
  let totalFrames = 0;
  let weightedBlinkRate = 0;
  let weightedGazeStability = 0;
  let weightedEAR = 0;
  let weightedFlowIndicator = 0;

  for (const w of windows) {
    totalFrames += w.frame_count;
    weightedBlinkRate += w.blink_rate * w.frame_count;
    weightedGazeStability += w.gaze_stability * w.frame_count;
    weightedEAR += w.average_ear * w.frame_count;
    weightedFlowIndicator += w.eye_flow_indicator * w.frame_count;
  }

  // Expected 6 windows per 30s, quality based on coverage
  const expectedWindows = 6;
  const quality = Math.min(1.0, windows.length / expectedWindows);

  return {
    blink_rate: totalFrames > 0 ? weightedBlinkRate / totalFrames : null,
    gaze_stability: totalFrames > 0 ? weightedGazeStability / totalFrames : null,
    average_ear: totalFrames > 0 ? weightedEAR / totalFrames : null,
    eye_flow_indicator: totalFrames > 0 ? weightedFlowIndicator / totalFrames : null,
    window_count: windows.length,
    quality,
  };
}

/**
 * Determine the scoring tier based on available data
 */
function determineTier(
  hasEyeData: boolean,
  hasHRV: boolean,
  hasEDA: boolean
): string {
  if (hasEyeData && hasHRV && hasEDA) {
    return "eye+hrv+eda";
  }
  if (hasEyeData && hasHRV) {
    return "eye+hrv";
  }
  return "eye-only";
}

/**
 * Calculate combined flow score using the same algorithm as the browser
 * (simplified version without calibration baselines)
 */
function calculateCombinedFlowScore(
  eyeMetrics: {
    gaze_stability: number | null;
    blink_rate: number | null;
    average_ear: number | null;
  },
  watchMetrics: {
    hrv_rmssd: number | null;
    eda_mean_scl: number | null;
  }
): { score: number | null; tier: string } {
  const hasEye = eyeMetrics.gaze_stability !== null;
  const hasHRV = watchMetrics.hrv_rmssd !== null;
  const hasEDA = watchMetrics.eda_mean_scl !== null;

  if (!hasEye) {
    return { score: null, tier: "none" };
  }

  const tier = determineTier(hasEye, hasHRV, hasEDA);

  // Use tier-specific weights from flow-calculator.ts
  let weights: Record<string, number>;
  if (tier === "eye+hrv+eda") {
    weights = { gaze: 0.30, blink: 0.25, ear: 0.10, hrv: 0.20, eda: 0.15 };
  } else if (tier === "eye+hrv") {
    weights = { gaze: 0.35, blink: 0.30, ear: 0.10, hrv: 0.25, eda: 0 };
  } else {
    weights = { gaze: 0.45, blink: 0.40, ear: 0.15, hrv: 0, eda: 0 };
  }

  // Simple scoring without calibration (0-1 range assumed for inputs)
  let score = 0;
  score += (eyeMetrics.gaze_stability ?? 0) * weights.gaze;
  // Blink rate scoring: assume 15 bpm is optimal, normalize
  const normalizedBlink = eyeMetrics.blink_rate
    ? Math.exp(-Math.pow((eyeMetrics.blink_rate - 15) / 10, 2))
    : 0;
  score += normalizedBlink * weights.blink;
  // EAR scoring: assume 0.25-0.35 is good
  const earScore = eyeMetrics.average_ear
    ? Math.exp(-Math.pow((eyeMetrics.average_ear - 0.30) / 0.05, 2))
    : 0;
  score += earScore * weights.ear;

  if (hasHRV && watchMetrics.hrv_rmssd) {
    // HRV scoring: 30-50ms RMSSD is good for focus
    const hrvScore = Math.exp(-Math.pow((watchMetrics.hrv_rmssd - 40) / 20, 2));
    score += hrvScore * weights.hrv;
  }

  if (hasEDA && watchMetrics.eda_mean_scl) {
    // EDA scoring: 2-8 µS is moderate arousal
    const edaScore = Math.exp(-Math.pow((watchMetrics.eda_mean_scl - 5) / 3, 2));
    score += edaScore * weights.eda;
  }

  return { score: Math.max(0, Math.min(1, score)), tier };
}

/**
 * Create a fused window by combining eye metrics and watch data
 * for a specific 30s time window
 */
export function createFusedWindow(
  sessionId: string,
  windowStart: number,
  windowEnd: number
): FusedWindowRow {
  // Get eye metrics that overlap with this window
  const eyeWindows = getEyeMetricsInRange(sessionId, windowStart, windowEnd);
  const eyeAgg = aggregateEyeMetrics(eyeWindows);

  // Get watch batch for this window (should be exactly one)
  const watchBatches = getWatchBatchInRange(sessionId, windowStart, windowEnd);
  const watch = watchBatches.length > 0 ? watchBatches[0] : null;

  // Calculate combined score
  const { score, tier } = calculateCombinedFlowScore(
    {
      gaze_stability: eyeAgg.gaze_stability,
      blink_rate: eyeAgg.blink_rate,
      average_ear: eyeAgg.average_ear,
    },
    {
      hrv_rmssd: watch?.hrv_rmssd ?? null,
      eda_mean_scl: watch?.eda_mean_scl ?? null,
    }
  );

  const fusedData: FusedWindowInsert = {
    session_id: sessionId,
    window_start: windowStart,
    window_end: windowEnd,
    eye_blink_rate: eyeAgg.blink_rate,
    eye_gaze_stability: eyeAgg.gaze_stability,
    eye_average_ear: eyeAgg.average_ear,
    eye_flow_indicator: eyeAgg.eye_flow_indicator,
    eye_window_count: eyeAgg.window_count,
    eye_quality: eyeAgg.quality,
    watch_hr_mean: watch?.hr_mean ?? null,
    watch_hr_min: watch?.hr_min ?? null,
    watch_hr_max: watch?.hr_max ?? null,
    watch_hrv_rmssd: watch?.hrv_rmssd ?? null,
    watch_hrv_sdnn: watch?.hrv_sdnn ?? null,
    watch_eda_mean_scl: watch?.eda_mean_scl ?? null,
    watch_quality: watch?.quality ?? 0,
    combined_flow_score: score,
    tier,
  };

  return insertFusedWindow(fusedData);
}

/**
 * Process pending fusion for a session
 * Creates fused windows for any 30s periods that have both eye and watch data
 * but no existing fused window
 */
export function processPendingFusion(sessionId: string): FusedWindowRow[] {
  const createdWindows: FusedWindowRow[] = [];

  // Get all existing fused window start times to know what's already processed
  // Query directly without limit to avoid duplicates for long sessions
  const db = getDatabase();
  const existingStarts = db
    .prepare("SELECT window_start FROM fused_windows WHERE session_id = ?")
    .all(sessionId) as { window_start: number }[];
  const processedStarts = new Set(existingStarts.map((f) => f.window_start));

  // Get the time range of available data
  const eyeRange = db
    .prepare(
      `SELECT MIN(window_start) as min_start, MAX(window_end) as max_end
       FROM eye_metrics WHERE session_id = ?`
    )
    .get(sessionId) as { min_start: number | null; max_end: number | null };

  const watchRange = db
    .prepare(
      `SELECT MIN(window_start) as min_start, MAX(window_end) as max_end
       FROM watch_batches WHERE session_id = ?`
    )
    .get(sessionId) as { min_start: number | null; max_end: number | null };

  if (!eyeRange.min_start) {
    return createdWindows; // No eye data yet
  }

  // Align to 30s boundaries
  const startTime = Math.floor(eyeRange.min_start / FUSION_WINDOW_MS) * FUSION_WINDOW_MS;
  const endTime = eyeRange.max_end ?? Date.now();

  // Create fused windows for each 30s period
  for (let windowStart = startTime; windowStart < endTime; windowStart += FUSION_WINDOW_MS) {
    if (processedStarts.has(windowStart)) {
      continue; // Already processed
    }

    const windowEnd = windowStart + FUSION_WINDOW_MS;

    // Check if we have eye data for this window
    const eyeCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM eye_metrics
         WHERE session_id = ? AND window_start >= ? AND window_end <= ?`
      )
      .get(sessionId, windowStart, windowEnd) as { count: number };

    if (eyeCount.count === 0) {
      continue; // No eye data for this window
    }

    // Create the fused window
    const fused = createFusedWindow(sessionId, windowStart, windowEnd);
    createdWindows.push(fused);
  }

  return createdWindows;
}

/**
 * Get summary statistics for a session
 */
export function getSessionStats(sessionId: string): {
  total_fused_windows: number;
  avg_flow_score: number | null;
  flow_time_seconds: number;
  total_time_seconds: number;
  tier_breakdown: Record<string, number>;
} {
  const db = getDatabase();

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         AVG(combined_flow_score) as avg_score,
         SUM(CASE WHEN combined_flow_score >= 0.65 THEN 30 ELSE 0 END) as flow_seconds,
         COUNT(*) * 30 as total_seconds
       FROM fused_windows WHERE session_id = ?`
    )
    .get(sessionId) as {
    total: number;
    avg_score: number | null;
    flow_seconds: number;
    total_seconds: number;
  };

  const tiers = db
    .prepare(
      `SELECT tier, COUNT(*) as count
       FROM fused_windows WHERE session_id = ?
       GROUP BY tier`
    )
    .all(sessionId) as { tier: string; count: number }[];

  const tierBreakdown: Record<string, number> = {};
  for (const t of tiers) {
    tierBreakdown[t.tier] = t.count;
  }

  return {
    total_fused_windows: stats.total,
    avg_flow_score: stats.avg_score,
    flow_time_seconds: stats.flow_seconds,
    total_time_seconds: stats.total_seconds,
    tier_breakdown: tierBreakdown,
  };
}
