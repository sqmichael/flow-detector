/**
 * MediaPipe Eye Tracking Type Definitions
 *
 * Types for eye landmark detection, blink detection, and gaze tracking
 * using MediaPipe Face Landmarker.
 */

import type { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";

// Re-export for convenience
export type { FaceLandmarkerResult, NormalizedLandmark };

/**
 * Landmark indices for eye tracking
 * Based on MediaPipe Face Mesh 468 landmark topology
 */
export const EYE_LANDMARK_INDICES = {
  // Right eye landmarks for EAR calculation
  rightEye: {
    outer: 33,
    inner: 133,
    upper1: 160,
    upper2: 158,
    lower1: 144,
    lower2: 153,
  },
  // Left eye landmarks for EAR calculation
  leftEye: {
    outer: 263,
    inner: 362,
    upper1: 385,
    upper2: 387,
    lower1: 380,
    lower2: 373,
  },
  // Iris landmarks (468-477 range)
  rightIris: {
    center: 468,
    top: 469,
    right: 470,
    bottom: 471,
    left: 472,
  },
  leftIris: {
    center: 473,
    top: 474,
    right: 475,
    bottom: 476,
    left: 477,
  },
} as const;

/**
 * Raw eye landmark positions extracted from face mesh
 */
export interface EyeLandmarks {
  rightEye: {
    outer: NormalizedLandmark;
    inner: NormalizedLandmark;
    upper1: NormalizedLandmark;
    upper2: NormalizedLandmark;
    lower1: NormalizedLandmark;
    lower2: NormalizedLandmark;
  };
  leftEye: {
    outer: NormalizedLandmark;
    inner: NormalizedLandmark;
    upper1: NormalizedLandmark;
    upper2: NormalizedLandmark;
    lower1: NormalizedLandmark;
    lower2: NormalizedLandmark;
  };
  rightIris: {
    center: NormalizedLandmark;
  };
  leftIris: {
    center: NormalizedLandmark;
  };
}

/**
 * Eye Aspect Ratio (EAR) values for both eyes
 * Lower values indicate more closed eyes
 * Typical range: 0.15 (closed) to 0.35 (open)
 */
export interface EyeAspectRatios {
  left: number;
  right: number;
  average: number;
}

/**
 * Gaze direction vector in normalized coordinates
 * x: -1 (left) to 1 (right)
 * y: -1 (down) to 1 (up)
 */
export interface GazeVector {
  x: number;
  y: number;
}

/**
 * Gaze data for both eyes
 */
export interface GazeData {
  left: GazeVector;
  right: GazeVector;
  combined: GazeVector;
  timestamp: number;
}

/**
 * Individual blink event
 */
export interface BlinkEvent {
  timestamp: number;
  duration: number; // milliseconds
  eye: "left" | "right" | "both";
}

/**
 * Blink detection state
 */
export interface BlinkState {
  isBlinking: boolean;
  blinkStartTime: number | null;
  recentBlinks: BlinkEvent[];
  blinkRate: number; // blinks per minute
}

/**
 * Frame-level eye metrics (computed each frame)
 */
export interface FrameEyeMetrics {
  timestamp: number;
  ear: EyeAspectRatios;
  gaze: GazeData;
  landmarks: EyeLandmarks | null;
}

/**
 * Aggregated eye metrics for a time window
 * These are the metrics that get merged into the biometric state vector
 */
export interface AggregatedEyeMetrics {
  /** Blinks per minute calculated over the window */
  blinkRate: number;

  /** Gaze stability score (0-1, higher = more stable) */
  gazeStability: number;

  /** Average Eye Aspect Ratio over the window */
  averageEAR: number;

  /** Eye-based flow indicator (0-1, derived from blink/gaze patterns) */
  eyeFlowIndicator: number;

  /** Start of aggregation window */
  windowStart: number;

  /** End of aggregation window */
  windowEnd: number;

  /** Number of frames processed in window */
  frameCount: number;
}

/**
 * Configuration for eye tracking
 */
export interface EyeTrackingConfig {
  /** Target frames per second for processing */
  targetFPS: number;

  /** Aggregation window in milliseconds (default 5000 to match biometric intervals) */
  aggregationWindowMs: number;

  /** EAR threshold below which a blink is detected */
  blinkEARThreshold: number;

  /** Minimum blink duration in ms to count as valid blink */
  minBlinkDurationMs: number;

  /** Maximum blink duration in ms (longer = not a blink) */
  maxBlinkDurationMs: number;

  /** Number of gaze samples for stability calculation */
  gazeStabilityWindowSize: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_EYE_TRACKING_CONFIG: EyeTrackingConfig = {
  targetFPS: 30,
  aggregationWindowMs: 5000,
  blinkEARThreshold: 0.2,
  minBlinkDurationMs: 50,
  maxBlinkDurationMs: 400,
  gazeStabilityWindowSize: 30,
};

/**
 * Eye tracking hook state
 */
export interface EyeTrackingState {
  isInitialized: boolean;
  isRunning: boolean;
  error: string | null;
  currentMetrics: AggregatedEyeMetrics | null;
  frameMetrics: FrameEyeMetrics | null;
  blinkState: BlinkState;
}

/**
 * Camera stream state
 */
export interface CameraStreamState {
  stream: MediaStream | null;
  permissionStatus: "prompt" | "granted" | "denied" | "unavailable";
  error: string | null;
  isLoading: boolean;
}
