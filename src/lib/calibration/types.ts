/**
 * Calibration Types
 *
 * Type definitions for the eye tracking calibration system.
 * Calibration captures personal baselines for EAR, gaze, and blink timing.
 */

/**
 * Eye Aspect Ratio calibration data
 */
export interface EARCalibration {
  /** Average EAR when eyes are open (typically 0.25-0.35) */
  openEyeEAR: number;
  /** Average EAR when eyes are closed during blink (typically 0.10-0.15) */
  closedEyeEAR: number;
  /** Calculated threshold: midpoint between open and closed */
  blinkThreshold: number;
  /** Standard deviation of open eye EAR for noise filtering */
  openEyeEARStdDev: number;
}

/**
 * Gaze calibration data
 */
export interface GazeCalibration {
  /** Personal gaze center when looking straight at camera */
  center: {
    x: number; // Normalized -1 to 1
    y: number; // Normalized -1 to 1
  };
  /** Standard deviation of gaze at center (for stability calculation) */
  centerStdDev: {
    x: number;
    y: number;
  };
}

/**
 * Blink timing calibration data
 */
export interface BlinkTimingCalibration {
  /** Average duration of user's natural blinks in ms */
  averageBlinkDuration: number;
  /** Minimum observed blink duration in ms */
  minBlinkDuration: number;
  /** Maximum observed blink duration in ms */
  maxBlinkDuration: number;
}

/**
 * Working baseline calibration data
 *
 * Captured during a 60-90 second period of normal activity (reading/typing)
 * to establish personal baselines for flow detection.
 */
export interface WorkingBaselineCalibration {
  /** Average blink rate during normal work (blinks/min) */
  blinkRateMean: number;
  /** Standard deviation of blink rate */
  blinkRateStdDev: number;
  /** Average gaze stability during normal work (0-1) */
  gazeStabilityMean: number;
  /** Standard deviation of gaze stability */
  gazeStabilityStdDev: number;
  /** Average EAR during normal work */
  earMean: number;
  /** Standard deviation of EAR */
  earStdDev: number;
  /** Duration of baseline capture in ms */
  captureDurationMs: number;
  /** Number of 5-second windows captured */
  windowCount: number;
}

/**
 * Complete calibration data stored in localStorage
 */
export interface CalibrationData {
  /** Version for migration support */
  version: 2;
  /** Timestamp when calibration was performed */
  calibratedAt: number;
  /** EAR baseline data */
  ear: EARCalibration;
  /** Gaze center data */
  gaze: GazeCalibration;
  /** Blink timing data */
  blinkTiming: BlinkTimingCalibration;
  /** Working baseline data for flow detection */
  workingBaseline: WorkingBaselineCalibration;
  /** Number of successful calibration samples collected */
  sampleCount: number;
}

/**
 * Calibration step identifiers
 */
export type CalibrationStep =
  | "idle"
  | "baseline"
  | "blink"
  | "gaze-center"
  | "working-baseline"
  | "complete";

/**
 * Configuration for each calibration step
 */
export interface CalibrationStepConfig {
  /** Duration in ms for timed steps */
  duration?: number;
  /** Number of blinks required for blink step */
  blinksRequired?: number;
  /** Instructions to display to user */
  instruction: string;
  /** Next step after this one completes */
  nextStep: CalibrationStep;
}

/**
 * Calibration step configurations
 */
export const CALIBRATION_STEPS: Record<
  Exclude<CalibrationStep, "idle" | "complete">,
  CalibrationStepConfig
> = {
  baseline: {
    duration: 3000,
    instruction: "Look at the camera naturally. Keep your eyes open.",
    nextStep: "blink",
  },
  blink: {
    blinksRequired: 5,
    instruction: "Blink naturally 5 times. Take your time.",
    nextStep: "gaze-center",
  },
  "gaze-center": {
    duration: 3000,
    instruction: "Look directly at the center dot below.",
    nextStep: "working-baseline",
  },
  "working-baseline": {
    duration: 60000, // 60 seconds of normal activity
    instruction: "Read the text below naturally. This captures your working baseline.",
    nextStep: "complete",
  },
};

/**
 * Working baseline window sample (5-second aggregation)
 */
export interface WorkingBaselineWindow {
  blinkRate: number;
  gazeStability: number;
  averageEAR: number;
  timestamp: number;
}

/**
 * Internal state for calibration process
 */
export interface CalibrationState {
  /** Current step in the calibration process */
  step: CalibrationStep;
  /** Progress within current step (0-1) */
  progress: number;
  /** Instructions to display to user */
  instruction: string;

  /** Collected EAR samples during baseline step */
  earSamples: number[];
  /** Collected gaze samples */
  gazeSamples: { x: number; y: number }[];
  /** Detected blink events with min EAR and duration */
  blinkEvents: { earMin: number; duration: number }[];
  /** Collected working baseline windows (5-second aggregations) */
  workingBaselineWindows: WorkingBaselineWindow[];

  /** Timestamp when current step started */
  stepStartTime: number | null;
  /** Number of blinks required (for blink step) */
  blinksRequired: number;
  /** Number of blinks detected so far */
  blinksDetected: number;

  /** Final calibration result */
  calibrationData: CalibrationData | null;
  /** Error message if calibration failed */
  error: string | null;
}

/**
 * Create initial calibration state
 */
export function createInitialCalibrationState(): CalibrationState {
  return {
    step: "idle",
    progress: 0,
    instruction: "",
    earSamples: [],
    gazeSamples: [],
    blinkEvents: [],
    workingBaselineWindows: [],
    stepStartTime: null,
    blinksRequired: 5,
    blinksDetected: 0,
    calibrationData: null,
    error: null,
  };
}
