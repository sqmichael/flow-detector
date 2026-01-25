/**
 * Eye Metrics Calculation Library
 *
 * Algorithms for computing eye-related metrics from MediaPipe face landmarks:
 * - Eye Aspect Ratio (EAR) for blink detection
 * - Gaze vector calculation from iris position
 * - Gaze stability scoring
 * - Blink rate and pattern analysis
 */

import type { NormalizedLandmark, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  EYE_LANDMARK_INDICES,
  type EyeLandmarks,
  type EyeAspectRatios,
  type GazeVector,
  type GazeData,
  type BlinkEvent,
  type BlinkState,
  type FrameEyeMetrics,
  type AggregatedEyeMetrics,
  type EyeTrackingConfig,
  DEFAULT_EYE_TRACKING_CONFIG,
} from "./types";

// Debug logging configuration
const DEBUG_CONFIG = {
  logRawLandmarks: true,      // Log raw x,y,z coordinates from MediaPipe
  logEARCalculation: true,    // Log Eye Aspect Ratio math
  logGazeCalculation: true,   // Log gaze vector calculation
  logBlinkDetection: true,    // Log blink state changes
  logEveryNthFrame: 30,       // Only log every Nth frame (reduce spam)
  logAggregation: true,       // Log aggregation details
};

let frameCounter = 0;

function shouldLog(): boolean {
  return frameCounter % DEBUG_CONFIG.logEveryNthFrame === 0;
}

/**
 * Calculate Euclidean distance between two landmarks
 */
function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Extract eye landmarks from face landmarker result
 *
 * @param result - FaceLandmarkerResult from MediaPipe
 * @returns EyeLandmarks or null if no face detected
 */
export function extractEyeLandmarks(
  result: FaceLandmarkerResult
): EyeLandmarks | null {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return null;
  }

  const landmarks = result.faceLandmarks[0];
  const indices = EYE_LANDMARK_INDICES;

  // Verify we have enough landmarks (need iris landmarks at 468+)
  if (landmarks.length < 478) {
    console.warn("[EyeMetrics] Insufficient landmarks for iris tracking");
    return null;
  }

  const eyeLandmarks = {
    rightEye: {
      outer: landmarks[indices.rightEye.outer],
      inner: landmarks[indices.rightEye.inner],
      upper1: landmarks[indices.rightEye.upper1],
      upper2: landmarks[indices.rightEye.upper2],
      lower1: landmarks[indices.rightEye.lower1],
      lower2: landmarks[indices.rightEye.lower2],
    },
    leftEye: {
      outer: landmarks[indices.leftEye.outer],
      inner: landmarks[indices.leftEye.inner],
      upper1: landmarks[indices.leftEye.upper1],
      upper2: landmarks[indices.leftEye.upper2],
      lower1: landmarks[indices.leftEye.lower1],
      lower2: landmarks[indices.leftEye.lower2],
    },
    rightIris: {
      center: landmarks[indices.rightIris.center],
    },
    leftIris: {
      center: landmarks[indices.leftIris.center],
    },
  };

  // Log raw landmark positions for verification
  if (DEBUG_CONFIG.logRawLandmarks && shouldLog()) {
    const rIris = eyeLandmarks.rightIris.center;
    const lIris = eyeLandmarks.leftIris.center;
    const rOuter = eyeLandmarks.rightEye.outer;
    const rInner = eyeLandmarks.rightEye.inner;

    // Sanity checks
    const warnings: string[] = [];
    if (rIris.x < 0 || rIris.x > 1) warnings.push('Right iris X out of range!');
    if (rIris.y < 0 || rIris.y > 1) warnings.push('Right iris Y out of range!');
    if (lIris.x < 0 || lIris.x > 1) warnings.push('Left iris X out of range!');
    if (lIris.y < 0 || lIris.y > 1) warnings.push('Left iris Y out of range!');

    // Check iris is within eye bounds (approximately)
    const eyeWidth = Math.abs(rOuter.x - rInner.x);
    if (eyeWidth < 0.01) warnings.push('Eye width suspiciously small!');
    if (eyeWidth > 0.2) warnings.push('Eye width suspiciously large!');

    console.log(
      `[RAW LANDMARKS] Frame ${frameCounter}\n` +
      `  Right Iris: x=${rIris.x.toFixed(4)}, y=${rIris.y.toFixed(4)}, z=${(rIris.z ?? 0).toFixed(4)}\n` +
      `  Left Iris:  x=${lIris.x.toFixed(4)}, y=${lIris.y.toFixed(4)}, z=${(lIris.z ?? 0).toFixed(4)}\n` +
      `  Right Eye:  outer=(${rOuter.x.toFixed(4)}, ${rOuter.y.toFixed(4)}) inner=(${rInner.x.toFixed(4)}, ${rInner.y.toFixed(4)})\n` +
      `  Eye Width:  ${(eyeWidth * 100).toFixed(2)}% of frame\n` +
      `  → Values should be 0-1 (normalized). Iris should be between outer/inner x coords.\n` +
      (warnings.length > 0 ? `  ⚠️ WARNINGS: ${warnings.join(', ')}` : '  ✅ All sanity checks passed')
    );
  }

  return eyeLandmarks;
}

/**
 * Calculate Eye Aspect Ratio (EAR) for a single eye
 *
 * EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
 *
 * Where p1-p6 are the 6 eye landmarks:
 * p1: outer corner, p4: inner corner
 * p2,p3: upper lid, p5,p6: lower lid
 *
 * @returns EAR value (typically 0.15-0.35 for open eyes)
 */
function calculateSingleEAR(eye: EyeLandmarks["rightEye"]): number {
  // Vertical distances
  const v1 = distance(eye.upper1, eye.lower1);
  const v2 = distance(eye.upper2, eye.lower2);

  // Horizontal distance
  const h = distance(eye.outer, eye.inner);

  if (h === 0) return 0;

  return (v1 + v2) / (2 * h);
}

/**
 * Calculate Eye Aspect Ratios for both eyes
 *
 * @param landmarks - Extracted eye landmarks
 * @returns EAR values for left, right, and average
 */
export function calculateEAR(landmarks: EyeLandmarks): EyeAspectRatios {
  const leftEAR = calculateSingleEAR(landmarks.leftEye);
  const rightEAR = calculateSingleEAR(landmarks.rightEye);

  const result = {
    left: leftEAR,
    right: rightEAR,
    average: (leftEAR + rightEAR) / 2,
  };

  // Log EAR calculation for verification
  if (DEBUG_CONFIG.logEARCalculation && shouldLog()) {
    // Calculate the raw distances for transparency
    const rEye = landmarks.rightEye;
    const v1 = distance(rEye.upper1, rEye.lower1);
    const v2 = distance(rEye.upper2, rEye.lower2);
    const h = distance(rEye.outer, rEye.inner);

    console.log(
      `[EAR CALCULATION] Frame ${frameCounter}\n` +
      `  Right Eye: v1=${v1.toFixed(4)}, v2=${v2.toFixed(4)}, h=${h.toFixed(4)}\n` +
      `  Formula: EAR = (v1 + v2) / (2 * h) = (${v1.toFixed(4)} + ${v2.toFixed(4)}) / (2 * ${h.toFixed(4)})\n` +
      `  Results: Left=${result.left.toFixed(3)}, Right=${result.right.toFixed(3)}, Avg=${result.average.toFixed(3)}\n` +
      `  → Normal open eye: 0.25-0.35 | Blink threshold: <0.20 | Currently: ${result.average < 0.2 ? 'EYES CLOSED' : 'EYES OPEN'}`
    );
  }

  return result;
}

/**
 * Calculate gaze vector for a single eye
 *
 * Computes iris position relative to eye corners,
 * normalized to -1 to 1 range.
 *
 * @param iris - Iris center landmark
 * @param eyeOuter - Outer corner of eye
 * @param eyeInner - Inner corner of eye
 * @returns Normalized gaze vector
 */
function calculateSingleGazeVector(
  iris: NormalizedLandmark,
  eyeOuter: NormalizedLandmark,
  eyeInner: NormalizedLandmark
): GazeVector {
  // Calculate eye width
  const eyeWidth = distance(eyeOuter, eyeInner);
  if (eyeWidth === 0) return { x: 0, y: 0 };

  // Calculate iris position relative to eye center
  const eyeCenterX = (eyeOuter.x + eyeInner.x) / 2;
  const eyeCenterY = (eyeOuter.y + eyeInner.y) / 2;

  // Normalize to -1 to 1 range
  // x: negative = looking left, positive = looking right
  // y: negative = looking down, positive = looking up
  const x = ((iris.x - eyeCenterX) / (eyeWidth / 2)) * 2;
  const y = -((iris.y - eyeCenterY) / (eyeWidth / 2)) * 2; // Flip Y for intuitive coordinates

  // Clamp to valid range
  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  };
}

/**
 * Calculate gaze data from eye landmarks
 *
 * @param landmarks - Extracted eye landmarks
 * @param timestamp - Current timestamp
 * @returns Gaze data for both eyes
 */
export function calculateGaze(
  landmarks: EyeLandmarks,
  timestamp: number
): GazeData {
  const leftGaze = calculateSingleGazeVector(
    landmarks.leftIris.center,
    landmarks.leftEye.outer,
    landmarks.leftEye.inner
  );

  const rightGaze = calculateSingleGazeVector(
    landmarks.rightIris.center,
    landmarks.rightEye.outer,
    landmarks.rightEye.inner
  );

  // Combined gaze is the average of both eyes
  const combined: GazeVector = {
    x: (leftGaze.x + rightGaze.x) / 2,
    y: (leftGaze.y + rightGaze.y) / 2,
  };

  // Log gaze calculation for verification
  if (DEBUG_CONFIG.logGazeCalculation && shouldLog()) {
    const gazeDirection = (x: number, y: number): string => {
      const h = x < -0.3 ? 'LEFT' : x > 0.3 ? 'RIGHT' : 'CENTER';
      const v = y < -0.3 ? 'DOWN' : y > 0.3 ? 'UP' : 'CENTER';
      return `${h}-${v}`;
    };

    console.log(
      `[GAZE CALCULATION] Frame ${frameCounter}\n` +
      `  Left Eye Gaze:  x=${leftGaze.x.toFixed(3)}, y=${leftGaze.y.toFixed(3)}\n` +
      `  Right Eye Gaze: x=${rightGaze.x.toFixed(3)}, y=${rightGaze.y.toFixed(3)}\n` +
      `  Combined Gaze:  x=${combined.x.toFixed(3)}, y=${combined.y.toFixed(3)}\n` +
      `  → Direction: ${gazeDirection(combined.x, combined.y)}\n` +
      `  → Range is -1 to 1. x: negative=left, positive=right. y: negative=down, positive=up`
    );
  }

  return {
    left: leftGaze,
    right: rightGaze,
    combined,
    timestamp,
  };
}

/**
 * Calculate gaze stability score from a history of gaze samples
 *
 * Stability is calculated as the inverse of gaze variance,
 * normalized to a 0-1 scale where 1 = perfectly stable.
 *
 * @param gazeHistory - Array of recent gaze data samples
 * @returns Stability score (0-1)
 */
export function calculateGazeStability(gazeHistory: GazeData[]): number {
  if (gazeHistory.length < 2) return 0.5; // Neutral if insufficient data

  // Calculate variance in combined gaze direction
  const xValues = gazeHistory.map((g) => g.combined.x);
  const yValues = gazeHistory.map((g) => g.combined.y);

  const xMean = xValues.reduce((a, b) => a + b, 0) / xValues.length;
  const yMean = yValues.reduce((a, b) => a + b, 0) / yValues.length;

  const xVariance =
    xValues.reduce((sum, x) => sum + Math.pow(x - xMean, 2), 0) / xValues.length;
  const yVariance =
    yValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0) / yValues.length;

  // Combined variance (using simple average)
  const totalVariance = (xVariance + yVariance) / 2;

  // Convert variance to stability score
  // Lower variance = higher stability
  // Use exponential decay: stability = e^(-k * variance)
  // k chosen so variance of 0.1 gives stability of ~0.5
  const k = 7;
  const stability = Math.exp(-k * totalVariance);

  return Math.max(0, Math.min(1, stability));
}

/**
 * Blink detection state machine
 *
 * Detects blinks by tracking EAR transitions:
 * - EAR drops below threshold -> potential blink start
 * - EAR returns above threshold -> blink end
 * - Duration must be within valid range
 */
export function updateBlinkState(
  currentState: BlinkState,
  ear: EyeAspectRatios,
  timestamp: number,
  config: EyeTrackingConfig = DEFAULT_EYE_TRACKING_CONFIG
): BlinkState {
  const isEyesClosed = ear.average < config.blinkEARThreshold;

  // Copy state for immutability
  const newState: BlinkState = {
    ...currentState,
    recentBlinks: [...currentState.recentBlinks],
  };

  if (isEyesClosed && !currentState.isBlinking) {
    // Blink starting
    newState.isBlinking = true;
    newState.blinkStartTime = timestamp;

    if (DEBUG_CONFIG.logBlinkDetection) {
      console.log(
        `[BLINK DETECTED] 👁️ BLINK START at ${timestamp.toFixed(0)}ms\n` +
        `  EAR dropped to ${ear.average.toFixed(3)} (threshold: ${config.blinkEARThreshold})\n` +
        `  → Eyes are now CLOSED`
      );
    }
  } else if (!isEyesClosed && currentState.isBlinking) {
    // Blink ending
    newState.isBlinking = false;

    if (currentState.blinkStartTime !== null) {
      const duration = timestamp - currentState.blinkStartTime;
      const isValidBlink = duration >= config.minBlinkDurationMs && duration <= config.maxBlinkDurationMs;

      if (DEBUG_CONFIG.logBlinkDetection) {
        console.log(
          `[BLINK DETECTED] 👁️ BLINK END at ${timestamp.toFixed(0)}ms\n` +
          `  Duration: ${duration.toFixed(0)}ms (valid range: ${config.minBlinkDurationMs}-${config.maxBlinkDurationMs}ms)\n` +
          `  → ${isValidBlink ? '✅ VALID BLINK COUNTED' : '❌ INVALID (too short or too long)'}`
        );
      }

      // Validate blink duration
      if (isValidBlink) {
        const blinkEvent: BlinkEvent = {
          timestamp: currentState.blinkStartTime,
          duration,
          eye: "both",
        };
        newState.recentBlinks.push(blinkEvent);
      }
    }
    newState.blinkStartTime = null;
  }

  // Remove old blinks (keep only last 60 seconds for rate calculation)
  const cutoff = timestamp - 60000;
  newState.recentBlinks = newState.recentBlinks.filter(
    (b) => b.timestamp > cutoff
  );

  // Calculate blink rate (blinks per minute)
  if (newState.recentBlinks.length > 0) {
    const oldestBlink = newState.recentBlinks[0];
    const timeSpanMs = Math.max(timestamp - oldestBlink.timestamp, 1000);
    const timeSpanMinutes = timeSpanMs / 60000;
    newState.blinkRate = newState.recentBlinks.length / timeSpanMinutes;
  } else {
    newState.blinkRate = 0;
  }

  return newState;
}

/**
 * Create initial blink state
 */
export function createInitialBlinkState(): BlinkState {
  return {
    isBlinking: false,
    blinkStartTime: null,
    recentBlinks: [],
    blinkRate: 0,
  };
}

/**
 * Calculate frame-level eye metrics
 *
 * @param result - FaceLandmarkerResult from MediaPipe
 * @param timestamp - Current timestamp
 * @returns Frame metrics or null if no face detected
 */
export function calculateFrameMetrics(
  result: FaceLandmarkerResult,
  timestamp: number
): FrameEyeMetrics | null {
  frameCounter++;

  const landmarks = extractEyeLandmarks(result);

  if (!landmarks) {
    if (shouldLog()) {
      console.log(`[FRAME ${frameCounter}] ⚠️ No face detected in frame`);
    }
    return null;
  }

  const ear = calculateEAR(landmarks);
  const gaze = calculateGaze(landmarks, timestamp);

  return {
    timestamp,
    ear,
    gaze,
    landmarks,
  };
}

/**
 * Calculate eye-based flow indicator
 *
 * Combines blink rate and gaze stability to estimate cognitive flow.
 * Based on research showing:
 * - Reduced blink rate (3-8/min) during focused attention
 * - Increased gaze stability during flow states
 *
 * @param blinkRate - Current blink rate (blinks/min)
 * @param gazeStability - Current gaze stability (0-1)
 * @returns Flow indicator (0-1)
 */
export function calculateEyeFlowIndicator(
  blinkRate: number,
  gazeStability: number
): number {
  // Optimal blink rate for flow: 3-8 per minute
  // Normal: 15-20, Overload: 20+
  let blinkScore: number;
  if (blinkRate <= 3) {
    blinkScore = 0.8; // Very low - might be too focused/strain
  } else if (blinkRate <= 8) {
    blinkScore = 1.0; // Optimal flow range
  } else if (blinkRate <= 15) {
    blinkScore = 0.7; // Normal range
  } else if (blinkRate <= 20) {
    blinkScore = 0.4; // High end of normal
  } else {
    blinkScore = 0.2; // Overload indicator
  }

  // Gaze stability thresholds for flow:
  // >0.7: flow state, 0.3-0.5: normal, <0.3: distracted
  let gazeScore: number;
  if (gazeStability >= 0.7) {
    gazeScore = 1.0;
  } else if (gazeStability >= 0.5) {
    gazeScore = 0.7;
  } else if (gazeStability >= 0.3) {
    gazeScore = 0.4;
  } else {
    gazeScore = 0.2;
  }

  // Weighted combination: blink 40%, gaze 60%
  // (gaze stability is more reliable indicator)
  return blinkScore * 0.4 + gazeScore * 0.6;
}

/**
 * Aggregate frame metrics over a time window
 *
 * @param frameHistory - Array of frame metrics
 * @param gazeHistory - Array of gaze data for stability calculation
 * @param blinkRate - Current blink rate from blink state
 * @param windowStart - Start of aggregation window
 * @param windowEnd - End of aggregation window
 * @returns Aggregated metrics for the window
 */
export function aggregateMetrics(
  frameHistory: FrameEyeMetrics[],
  gazeHistory: GazeData[],
  blinkRate: number,
  windowStart: number,
  windowEnd: number
): AggregatedEyeMetrics {
  if (frameHistory.length === 0) {
    return {
      blinkRate: 0,
      gazeStability: 0.5,
      averageEAR: 0.25,
      eyeFlowIndicator: 0.5,
      windowStart,
      windowEnd,
      frameCount: 0,
    };
  }

  // Calculate average EAR
  const totalEAR = frameHistory.reduce(
    (sum, frame) => sum + frame.ear.average,
    0
  );
  const averageEAR = totalEAR / frameHistory.length;

  // Calculate gaze stability
  const gazeStability = calculateGazeStability(gazeHistory);

  // Calculate flow indicator
  const eyeFlowIndicator = calculateEyeFlowIndicator(blinkRate, gazeStability);

  const result = {
    blinkRate,
    gazeStability,
    averageEAR,
    eyeFlowIndicator,
    windowStart,
    windowEnd,
    frameCount: frameHistory.length,
  };

  // Log aggregation details for verification
  if (DEBUG_CONFIG.logAggregation) {
    const windowDurationSec = ((windowEnd - windowStart) / 1000).toFixed(1);
    const fps = (frameHistory.length / ((windowEnd - windowStart) / 1000)).toFixed(1);

    console.log(
      `\n${'='.repeat(60)}\n` +
      `[AGGREGATION COMPLETE] 5-Second Window Summary\n` +
      `${'='.repeat(60)}\n` +
      `  Window Duration: ${windowDurationSec}s | Frames Processed: ${frameHistory.length} (~${fps} FPS)\n` +
      `\n  📊 METRICS:\n` +
      `  ├─ Blink Rate:     ${blinkRate.toFixed(1)} blinks/min\n` +
      `  │   → Optimal: 3-8/min (flow), Normal: 15-20/min, High: 20+/min\n` +
      `  ├─ Gaze Stability: ${(gazeStability * 100).toFixed(1)}%\n` +
      `  │   → >70%: focused, 50-70%: normal, <50%: distracted\n` +
      `  ├─ Average EAR:    ${averageEAR.toFixed(3)}\n` +
      `  │   → Open eyes: 0.25-0.35, Closed: <0.20\n` +
      `  └─ Flow Indicator: ${(eyeFlowIndicator * 100).toFixed(1)}%\n` +
      `      → Calculation: (blink_score × 0.4) + (gaze_score × 0.6)\n` +
      `\n  🎯 INTERPRETATION:\n` +
      `  ${eyeFlowIndicator >= 0.7 ? '🟢 IN FLOW STATE - High focus detected' :
         eyeFlowIndicator >= 0.5 ? '🟡 MODERATE FOCUS - Normal engagement' :
         '🔴 DISTRACTED - Low engagement detected'}\n` +
      `${'='.repeat(60)}\n`
    );
  }

  return result;
}
