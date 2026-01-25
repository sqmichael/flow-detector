/**
 * Calibration Hook
 *
 * Manages the three-step calibration process:
 * 1. Baseline - capture open eye EAR
 * 2. Blink - capture blink EAR and timing
 * 3. Gaze Center - capture personal gaze center
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  initializeFaceLandmarker,
  detectFaceLandmarks,
  isFaceLandmarkerInitialized,
} from "@/lib/mediapipe/face-landmarker";
import { calculateFrameMetrics } from "@/lib/mediapipe/eye-metrics";
import {
  type CalibrationData,
  type CalibrationState,
  type CalibrationStep,
  type WorkingBaselineWindow,
  CALIBRATION_STEPS,
  createInitialCalibrationState,
} from "@/lib/calibration/types";
import {
  calculateGazeStability,
  createInitialBlinkState,
  updateBlinkState,
} from "@/lib/mediapipe/eye-metrics";
import type { BlinkState } from "@/lib/mediapipe/types";
import { buildCalibrationData } from "@/lib/calibration/processor";
import {
  saveCalibration,
  loadCalibration,
  clearCalibration,
} from "@/lib/calibration/storage";

export interface UseCalibrationOptions {
  /** Video element to process */
  videoElement: HTMLVideoElement | null;
  /** Callback when calibration completes successfully */
  onComplete?: (data: CalibrationData) => void;
  /** Callback when calibration fails */
  onError?: (error: string) => void;
}

export interface UseCalibrationReturn {
  /** Current calibration state */
  state: CalibrationState;
  /** Start the calibration process */
  startCalibration: () => Promise<void>;
  /** Cancel ongoing calibration */
  cancelCalibration: () => void;
  /** Whether calibration is currently running */
  isCalibrating: boolean;
  /** Loaded calibration data (from localStorage or just calibrated) */
  calibrationData: CalibrationData | null;
  /** Whether valid calibration exists */
  hasCalibration: boolean;
  /** Clear stored calibration */
  clearStoredCalibration: () => void;
}

// Temporary threshold for detecting blinks during calibration
// Set lower than typical to catch most blinks
const CALIBRATION_BLINK_THRESHOLD = 0.18;

export function useCalibration({
  videoElement,
  onComplete,
  onError,
}: UseCalibrationOptions): UseCalibrationReturn {
  const [state, setState] = useState<CalibrationState>(
    createInitialCalibrationState()
  );
  const [calibrationData, setCalibrationData] =
    useState<CalibrationData | null>(null);

  // Refs for frame processing
  const animationFrameRef = useRef<number | null>(null);
  const stateRef = useRef<CalibrationState>(state);

  // Blink detection state during calibration
  const isBlinkingRef = useRef(false);
  const blinkStartTimeRef = useRef<number | null>(null);
  const blinkMinEARRef = useRef<number>(1);

  // Working baseline step state
  const workingBlinkStateRef = useRef<BlinkState>(createInitialBlinkState());
  const workingGazeHistoryRef = useRef<{ x: number; y: number; timestamp: number }[]>([]);
  const workingEARHistoryRef = useRef<number[]>([]);
  const workingWindowStartRef = useRef<number>(0);
  const workingWindowsRef = useRef<WorkingBaselineWindow[]>([]);

  // Keep state ref in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Load existing calibration on mount
  useEffect(() => {
    const existing = loadCalibration();
    if (existing) {
      setCalibrationData(existing);
    }
  }, []);

  /**
   * Transition to next calibration step
   */
  const transitionToStep = useCallback((nextStep: CalibrationStep) => {
    if (nextStep === "complete") {
      // Build final calibration data
      const currentState = stateRef.current;
      const data = buildCalibrationData(
        currentState.earSamples,
        currentState.blinkEvents,
        currentState.gazeSamples,
        workingWindowsRef.current
      );

      // Save to localStorage
      saveCalibration(data);
      setCalibrationData(data);

      setState((prev) => ({
        ...prev,
        step: "complete",
        progress: 1,
        instruction: "Calibration complete!",
        calibrationData: data,
      }));

      console.log("[Calibration] Complete:", data);
      return;
    }

    const stepConfig = CALIBRATION_STEPS[nextStep as keyof typeof CALIBRATION_STEPS];

    // Reset working baseline state when entering that step
    if (nextStep === "working-baseline") {
      workingBlinkStateRef.current = createInitialBlinkState();
      workingGazeHistoryRef.current = [];
      workingEARHistoryRef.current = [];
      workingWindowStartRef.current = performance.now();
      workingWindowsRef.current = [];
    }

    setState((prev) => ({
      ...prev,
      step: nextStep,
      progress: 0,
      instruction: stepConfig.instruction,
      stepStartTime: performance.now(),
      blinksDetected: 0,
    }));

    console.log("[Calibration] Transitioning to step:", nextStep);
  }, []);

  /**
   * Process a frame during baseline step
   */
  const processBaselineFrame = useCallback(
    (ear: number, timestamp: number) => {
      const currentState = stateRef.current;
      const stepConfig = CALIBRATION_STEPS.baseline;
      const elapsed = timestamp - (currentState.stepStartTime ?? timestamp);
      const progress = Math.min(elapsed / stepConfig.duration!, 1);

      // Only collect samples if eyes are likely open (above threshold)
      if (ear > CALIBRATION_BLINK_THRESHOLD) {
        setState((prev) => ({
          ...prev,
          progress,
          earSamples: [...prev.earSamples, ear],
        }));
      } else {
        setState((prev) => ({ ...prev, progress }));
      }

      // Check if step is complete
      if (progress >= 1) {
        transitionToStep(stepConfig.nextStep);
      }
    },
    [transitionToStep]
  );

  /**
   * Process a frame during blink step
   */
  const processBlinkFrame = useCallback(
    (ear: number, timestamp: number) => {
      const currentState = stateRef.current;
      const isEyesClosed = ear < CALIBRATION_BLINK_THRESHOLD;

      // Track minimum EAR during blink
      if (isEyesClosed) {
        blinkMinEARRef.current = Math.min(blinkMinEARRef.current, ear);
      }

      if (isEyesClosed && !isBlinkingRef.current) {
        // Blink starting
        isBlinkingRef.current = true;
        blinkStartTimeRef.current = timestamp;
        blinkMinEARRef.current = ear;
      } else if (!isEyesClosed && isBlinkingRef.current) {
        // Blink ending
        isBlinkingRef.current = false;

        if (blinkStartTimeRef.current !== null) {
          const duration = timestamp - blinkStartTimeRef.current;

          // Only count blinks with reasonable duration (30-500ms)
          if (duration >= 30 && duration <= 500) {
            const blinkEvent = {
              earMin: blinkMinEARRef.current,
              duration,
            };

            const newBlinksDetected = currentState.blinksDetected + 1;
            const progress = newBlinksDetected / currentState.blinksRequired;

            console.log(
              `[Calibration] Blink ${newBlinksDetected}/${currentState.blinksRequired}:`,
              {
                earMin: blinkEvent.earMin.toFixed(3),
                duration: `${duration.toFixed(0)}ms`,
              }
            );

            setState((prev) => ({
              ...prev,
              progress,
              blinksDetected: newBlinksDetected,
              blinkEvents: [...prev.blinkEvents, blinkEvent],
            }));

            // Check if we have enough blinks
            if (newBlinksDetected >= currentState.blinksRequired) {
              transitionToStep(CALIBRATION_STEPS.blink.nextStep);
            }
          }
        }

        blinkStartTimeRef.current = null;
      }
    },
    [transitionToStep]
  );

  /**
   * Process a frame during gaze-center step
   */
  const processGazeCenterFrame = useCallback(
    (gazeX: number, gazeY: number, timestamp: number) => {
      const currentState = stateRef.current;
      const stepConfig = CALIBRATION_STEPS["gaze-center"];
      const elapsed = timestamp - (currentState.stepStartTime ?? timestamp);
      const progress = Math.min(elapsed / stepConfig.duration!, 1);

      setState((prev) => ({
        ...prev,
        progress,
        gazeSamples: [...prev.gazeSamples, { x: gazeX, y: gazeY }],
      }));

      // Check if step is complete
      if (progress >= 1) {
        transitionToStep(stepConfig.nextStep);
      }
    },
    [transitionToStep]
  );

  /**
   * Process a frame during working-baseline step
   *
   * This step collects 60 seconds of data while the user reads/works normally.
   * We aggregate into 5-second windows to capture blink rate and gaze stability.
   */
  const processWorkingBaselineFrame = useCallback(
    (ear: number, gazeX: number, gazeY: number, timestamp: number) => {
      const currentState = stateRef.current;
      const stepConfig = CALIBRATION_STEPS["working-baseline"];
      const elapsed = timestamp - (currentState.stepStartTime ?? timestamp);
      const progress = Math.min(elapsed / stepConfig.duration!, 1);

      // Update blink state for this frame
      const earData = { left: ear, right: ear, average: ear };
      workingBlinkStateRef.current = updateBlinkState(
        workingBlinkStateRef.current,
        earData,
        timestamp,
        { blinkEARThreshold: CALIBRATION_BLINK_THRESHOLD, minBlinkDurationMs: 50, maxBlinkDurationMs: 400, targetFPS: 30, aggregationWindowMs: 5000, gazeStabilityWindowSize: 30 }
      );

      // Store gaze and EAR for this frame
      workingGazeHistoryRef.current.push({ x: gazeX, y: gazeY, timestamp });
      workingEARHistoryRef.current.push(ear);

      // Keep only last 5 seconds of gaze history for stability calculation
      const gazeWindowStart = timestamp - 5000;
      workingGazeHistoryRef.current = workingGazeHistoryRef.current.filter(
        (g) => g.timestamp > gazeWindowStart
      );

      // Check if 5-second window has elapsed
      const windowElapsed = timestamp - workingWindowStartRef.current;
      if (windowElapsed >= 5000) {
        // Calculate metrics for this window
        const gazeData = workingGazeHistoryRef.current.map((g) => ({
          combined: { x: g.x, y: g.y },
          left: { x: g.x, y: g.y },
          right: { x: g.x, y: g.y },
          timestamp: g.timestamp,
        }));
        const gazeStability = calculateGazeStability(gazeData);
        const averageEAR =
          workingEARHistoryRef.current.length > 0
            ? workingEARHistoryRef.current.reduce((a, b) => a + b, 0) /
              workingEARHistoryRef.current.length
            : 0.28;

        const window: WorkingBaselineWindow = {
          blinkRate: workingBlinkStateRef.current.blinkRate,
          gazeStability,
          averageEAR,
          timestamp,
        };

        workingWindowsRef.current.push(window);

        console.log(
          `[Calibration] Working baseline window ${workingWindowsRef.current.length}:`,
          {
            blinkRate: window.blinkRate.toFixed(1),
            gazeStability: (window.gazeStability * 100).toFixed(0) + "%",
            ear: window.averageEAR.toFixed(3),
          }
        );

        // Reset for next window
        workingWindowStartRef.current = timestamp;
        workingEARHistoryRef.current = [];
      }

      setState((prev) => ({
        ...prev,
        progress,
        workingBaselineWindows: workingWindowsRef.current,
      }));

      // Check if step is complete
      if (progress >= 1) {
        transitionToStep(stepConfig.nextStep);
      }
    },
    [transitionToStep]
  );

  /**
   * Main frame processing loop
   */
  const processFrame = useCallback(
    (timestamp: number) => {
      if (!videoElement || videoElement.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const currentState = stateRef.current;

      // Stop if calibration is idle or complete
      if (currentState.step === "idle" || currentState.step === "complete") {
        return;
      }

      // Detect face landmarks
      const result = detectFaceLandmarks(videoElement, timestamp);
      if (!result) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // Calculate frame metrics
      const frameMetrics = calculateFrameMetrics(result, timestamp);
      if (!frameMetrics) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const ear = frameMetrics.ear.average;
      const gazeX = frameMetrics.gaze.combined.x;
      const gazeY = frameMetrics.gaze.combined.y;

      // Process based on current step
      switch (currentState.step) {
        case "baseline":
          processBaselineFrame(ear, timestamp);
          break;
        case "blink":
          processBlinkFrame(ear, timestamp);
          break;
        case "gaze-center":
          processGazeCenterFrame(gazeX, gazeY, timestamp);
          break;
        case "working-baseline":
          processWorkingBaselineFrame(ear, gazeX, gazeY, timestamp);
          break;
      }

      // Continue loop
      animationFrameRef.current = requestAnimationFrame(processFrame);
    },
    [
      videoElement,
      processBaselineFrame,
      processBlinkFrame,
      processGazeCenterFrame,
      processWorkingBaselineFrame,
    ]
  );

  /**
   * Start calibration
   */
  const startCalibration = useCallback(async () => {
    if (!videoElement) {
      const error = "Video element not available";
      setState((prev) => ({ ...prev, error }));
      onError?.(error);
      return;
    }

    // Initialize MediaPipe if needed
    if (!isFaceLandmarkerInitialized()) {
      try {
        await initializeFaceLandmarker();
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Failed to initialize";
        setState((prev) => ({ ...prev, error }));
        onError?.(error);
        return;
      }
    }

    // Reset state
    const initialState = createInitialCalibrationState();
    setState(initialState);
    stateRef.current = initialState;

    // Reset blink tracking refs
    isBlinkingRef.current = false;
    blinkStartTimeRef.current = null;
    blinkMinEARRef.current = 1;

    // Reset working baseline refs
    workingBlinkStateRef.current = createInitialBlinkState();
    workingGazeHistoryRef.current = [];
    workingEARHistoryRef.current = [];
    workingWindowStartRef.current = 0;
    workingWindowsRef.current = [];

    console.log("[Calibration] Starting calibration");

    // Start with baseline step
    transitionToStep("baseline");

    // Start frame processing
    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [videoElement, onError, transitionToStep, processFrame]);

  /**
   * Cancel calibration
   */
  const cancelCalibration = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setState(createInitialCalibrationState());
    console.log("[Calibration] Cancelled");
  }, []);

  /**
   * Clear stored calibration
   */
  const clearStoredCalibration = useCallback(() => {
    clearCalibration();
    setCalibrationData(null);
    setState(createInitialCalibrationState());
  }, []);

  // Notify on completion
  useEffect(() => {
    if (state.step === "complete" && state.calibrationData) {
      onComplete?.(state.calibrationData);
    }
  }, [state.step, state.calibrationData, onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    state,
    startCalibration,
    cancelCalibration,
    isCalibrating:
      state.step !== "idle" && state.step !== "complete",
    calibrationData,
    hasCalibration: calibrationData !== null,
    clearStoredCalibration,
  };
}

export default useCalibration;
