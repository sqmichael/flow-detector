/**
 * Eye Tracking Hook
 *
 * Main hook for eye tracking functionality.
 * Manages FaceLandmarker initialization, video frame processing,
 * and metric aggregation on 5-second intervals.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  initializeFaceLandmarker,
  disposeFaceLandmarker,
  detectFaceLandmarks,
  isFaceLandmarkerInitialized,
} from "@/lib/mediapipe/face-landmarker";
import {
  calculateFrameMetrics,
  updateBlinkState,
  createInitialBlinkState,
  aggregateMetrics,
} from "@/lib/mediapipe/eye-metrics";
import type {
  EyeTrackingState,
  EyeTrackingConfig,
  AggregatedEyeMetrics,
  FrameEyeMetrics,
  GazeData,
  BlinkState,
} from "@/lib/mediapipe/types";
import type { CalibrationData } from "@/lib/calibration/types";

export interface UseEyeTrackingOptions {
  /** Video element to process */
  videoElement: HTMLVideoElement | null;
  /** Whether tracking should be active */
  enabled?: boolean;
  /** Configuration overrides */
  config?: Partial<EyeTrackingConfig>;
  /** Calibration data for personalized thresholds */
  calibration?: CalibrationData | null;
  /** Callback when new aggregated metrics are available */
  onMetrics?: (metrics: AggregatedEyeMetrics) => void;
}

export interface UseEyeTrackingReturn {
  /** Current tracking state */
  state: EyeTrackingState;
  /** Start eye tracking */
  start: () => Promise<boolean>;
  /** Stop eye tracking */
  stop: () => void;
  /** Current aggregated metrics */
  metrics: AggregatedEyeMetrics | null;
}

const DEFAULT_CONFIG: EyeTrackingConfig = {
  targetFPS: 30,
  aggregationWindowMs: 5000,
  blinkEARThreshold: 0.2,
  minBlinkDurationMs: 50,
  maxBlinkDurationMs: 400,
  gazeStabilityWindowSize: 30,
};

/**
 * Derive config from calibration data
 *
 * Overrides default thresholds with personalized values
 */
function deriveConfigFromCalibration(
  baseConfig: EyeTrackingConfig,
  calibration: CalibrationData | null | undefined
): EyeTrackingConfig {
  if (!calibration) return baseConfig;

  return {
    ...baseConfig,
    blinkEARThreshold: calibration.ear.blinkThreshold,
    // Add buffer to min/max durations based on personal timing
    minBlinkDurationMs: Math.max(
      30,
      calibration.blinkTiming.minBlinkDuration - 20
    ),
    maxBlinkDurationMs: calibration.blinkTiming.maxBlinkDuration + 50,
  };
}

/**
 * Hook for eye tracking using MediaPipe FaceLandmarker
 *
 * @example
 * ```tsx
 * const { videoRef } = useCameraStream();
 * const { state, start, stop, metrics } = useEyeTracking({
 *   videoElement: videoRef.current,
 *   enabled: true,
 *   onMetrics: (m) => console.log('Eye metrics:', m),
 * });
 * ```
 */
export function useEyeTracking({
  videoElement,
  enabled = false,
  config: configOverrides,
  calibration,
  onMetrics,
}: UseEyeTrackingOptions): UseEyeTrackingReturn {
  // Derive config from calibration, then apply any manual overrides
  const calibratedConfig = deriveConfigFromCalibration(DEFAULT_CONFIG, calibration);
  const config: EyeTrackingConfig = { ...calibratedConfig, ...configOverrides };

  // Log when using calibrated thresholds
  if (calibration && enabled) {
    console.log("[EyeTracking] Using calibrated thresholds:", {
      blinkEARThreshold: config.blinkEARThreshold.toFixed(3),
      blinkDurationRange: `${config.minBlinkDurationMs}-${config.maxBlinkDurationMs}ms`,
    });
  }

  const [state, setState] = useState<EyeTrackingState>({
    isInitialized: false,
    isRunning: false,
    error: null,
    currentMetrics: null,
    frameMetrics: null,
    blinkState: createInitialBlinkState(),
  });

  const [metrics, setMetrics] = useState<AggregatedEyeMetrics | null>(null);

  // Refs for animation frame loop
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameHistoryRef = useRef<FrameEyeMetrics[]>([]);
  const gazeHistoryRef = useRef<GazeData[]>([]);
  const blinkStateRef = useRef<BlinkState>(createInitialBlinkState());
  const windowStartRef = useRef<number>(0);
  const onMetricsRef = useRef(onMetrics);

  // Keep callback ref updated
  useEffect(() => {
    onMetricsRef.current = onMetrics;
  }, [onMetrics]);

  /**
   * Initialize FaceLandmarker
   */
  const initialize = useCallback(async (): Promise<boolean> => {
    if (isFaceLandmarkerInitialized()) {
      setState((prev) => ({ ...prev, isInitialized: true }));
      return true;
    }

    try {
      await initializeFaceLandmarker();
      setState((prev) => ({ ...prev, isInitialized: true, error: null }));
      console.log("[EyeTracking] Initialized");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize eye tracking";
      setState((prev) => ({
        ...prev,
        isInitialized: false,
        error: message,
      }));
      console.error("[EyeTracking] Initialization failed:", message);
      return false;
    }
  }, []);

  /**
   * Process a single video frame
   */
  const processFrame = useCallback(
    (timestamp: number) => {
      if (!videoElement || videoElement.readyState < 2) {
        return;
      }

      // Detect face landmarks
      const result = detectFaceLandmarks(videoElement, timestamp);
      if (!result) return;

      // Calculate frame metrics
      const frameMetrics = calculateFrameMetrics(result, timestamp);
      if (!frameMetrics) return;

      // Update blink state
      blinkStateRef.current = updateBlinkState(
        blinkStateRef.current,
        frameMetrics.ear,
        timestamp,
        config
      );

      // Store frame metrics
      frameHistoryRef.current.push(frameMetrics);

      // Store gaze data for stability calculation
      gazeHistoryRef.current.push(frameMetrics.gaze);
      if (gazeHistoryRef.current.length > config.gazeStabilityWindowSize) {
        gazeHistoryRef.current.shift();
      }

      // Update state with latest frame metrics
      setState((prev) => ({
        ...prev,
        frameMetrics,
        blinkState: blinkStateRef.current,
      }));

      // Check if aggregation window has elapsed
      if (timestamp - windowStartRef.current >= config.aggregationWindowMs) {
        // Aggregate metrics (pass gaze calibration if available)
        const aggregated = aggregateMetrics(
          frameHistoryRef.current,
          gazeHistoryRef.current,
          blinkStateRef.current.blinkRate,
          windowStartRef.current,
          timestamp,
          calibration?.gaze
        );

        // Update state and notify
        setMetrics(aggregated);
        setState((prev) => ({ ...prev, currentMetrics: aggregated }));
        onMetricsRef.current?.(aggregated);

        // Reset for next window
        frameHistoryRef.current = [];
        windowStartRef.current = timestamp;

        console.log("[EyeTracking] Aggregated metrics:", {
          blinkRate: aggregated.blinkRate.toFixed(1),
          gazeStability: aggregated.gazeStability.toFixed(2),
          flowIndicator: aggregated.eyeFlowIndicator.toFixed(2),
        });
      }
    },
    [videoElement, config, calibration]
  );

  /**
   * Animation frame loop
   */
  const frameLoop = useCallback(
    (timestamp: number) => {
      // Frame rate limiting
      const elapsed = timestamp - lastFrameTimeRef.current;
      const frameInterval = 1000 / config.targetFPS;

      if (elapsed >= frameInterval) {
        lastFrameTimeRef.current = timestamp - (elapsed % frameInterval);
        processFrame(timestamp);
      }

      // Continue loop
      animationFrameRef.current = requestAnimationFrame(frameLoop);
    },
    [processFrame, config.targetFPS]
  );

  /**
   * Start eye tracking
   */
  const start = useCallback(async (): Promise<boolean> => {
    if (state.isRunning) {
      return true;
    }

    if (!videoElement) {
      setState((prev) => ({
        ...prev,
        error: "Video element not available",
      }));
      return false;
    }

    // Initialize if needed
    if (!state.isInitialized) {
      const initialized = await initialize();
      if (!initialized) {
        return false;
      }
    }

    // Reset tracking state
    frameHistoryRef.current = [];
    gazeHistoryRef.current = [];
    blinkStateRef.current = createInitialBlinkState();
    windowStartRef.current = performance.now();
    lastFrameTimeRef.current = 0;

    // Start frame processing loop
    setState((prev) => ({
      ...prev,
      isRunning: true,
      error: null,
      blinkState: createInitialBlinkState(),
    }));

    animationFrameRef.current = requestAnimationFrame(frameLoop);
    console.log("[EyeTracking] Started");
    return true;
  }, [state.isRunning, state.isInitialized, videoElement, initialize, frameLoop]);

  /**
   * Stop eye tracking
   */
  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      isRunning: false,
    }));

    console.log("[EyeTracking] Stopped");
  }, []);

  // Auto-start/stop based on enabled prop
  useEffect(() => {
    if (enabled && videoElement && !state.isRunning) {
      start();
    } else if (!enabled && state.isRunning) {
      stop();
    }
  }, [enabled, videoElement, state.isRunning, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      disposeFaceLandmarker();
    };
  }, []);

  return {
    state,
    start,
    stop,
    metrics,
  };
}

export default useEyeTracking;
