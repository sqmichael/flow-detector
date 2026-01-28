"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useCameraStream } from "@/hooks/use-camera-stream";
import { useEyeTracking } from "@/hooks/use-eye-tracking";
import { useWatchStream } from "@/hooks/use-watch-stream";
import { useCalibration } from "@/hooks/use-calibration";
import {
  calculateCombinedFlow,
  updateFlowDetector,
  createFlowDetectorState,
  type FlowDetectorState,
} from "@/lib/biometrics/flow-calculator";
import { formatCalibrationDate } from "@/lib/calibration/storage";
import { CalibrationOverlay } from "@/components/calibration/CalibrationOverlay";
import type { CombinedFlowMetrics } from "@/lib/biometrics/types";

export default function Home() {
  const { state: cameraState, videoRef, startStream, stopStream } = useCameraStream();
  const [isTracking, setIsTracking] = useState(false);
  const [metricsHistory, setMetricsHistory] = useState<CombinedFlowMetrics[]>([]);

  // Flow detector state for EMA smoothing
  const flowDetectorRef = useRef<FlowDetectorState>(createFlowDetectorState());
  const [flowState, setFlowState] = useState<FlowDetectorState>(createFlowDetectorState());

  // Galaxy Watch stream (HR + IBI + EDA via relay server)
  const {
    isRelayConnected,
    isWatchConnected: watchStreamConnected,
    watchDeviceName: watchStreamDeviceName,
    heartRate: watchStreamHeartRate,
    hrvMetrics: watchStreamHrvMetrics,
    currentSCL,
    error: watchStreamError,
  } = useWatchStream();

  // Keep HRV metrics in a ref for the calibration getter (avoids stale closures)
  const hrvMetricsRef = useRef(watchStreamHrvMetrics);
  hrvMetricsRef.current = watchStreamHrvMetrics;

  // Calibration
  const {
    state: calibrationState,
    startCalibration,
    cancelCalibration,
    isCalibrating,
    calibrationData,
    hasCalibration,
    clearStoredCalibration,
  } = useCalibration({
    videoElement: videoRef.current,
    onComplete: (data) => {
      console.log("[Page] Calibration complete:", data);
    },
    getHrvMetrics: () => hrvMetricsRef.current,
  });

  // Galaxy Watch is the sole cardiac/EDA source
  const effectiveHeartRate = watchStreamHeartRate;
  const effectiveHrvMetrics = watchStreamHrvMetrics;
  const effectiveEDA = currentSCL;

  // Callback to handle new metrics with EMA smoothing
  const handleMetrics = useCallback(
    (m: Parameters<typeof calculateCombinedFlow>[0]) => {
      // Calculate combined flow with working baseline from calibration
      const combined = calculateCombinedFlow(
        m,
        effectiveHrvMetrics,
        effectiveHeartRate,
        calibrationData?.workingBaseline ?? null,
        effectiveEDA !== null ? { scl: effectiveEDA } : null
      );

      // Update flow detector with EMA smoothing
      const newFlowState = updateFlowDetector(
        flowDetectorRef.current,
        combined.combinedFlowScore,
        Date.now()
      );
      flowDetectorRef.current = newFlowState;
      setFlowState(newFlowState);

      // Store in history with smoothed score
      const smoothedCombined = {
        ...combined,
        combinedFlowScore: newFlowState.smoothedScore,
      };
      setMetricsHistory((prev) => [...prev.slice(-11), smoothedCombined]);
    },
    [effectiveHeartRate, effectiveHrvMetrics, effectiveEDA, calibrationData]
  );

  const { state: trackingState, metrics } = useEyeTracking({
    videoElement: videoRef.current,
    enabled: isTracking && !isCalibrating,
    calibration: calibrationData,
    onMetrics: handleMetrics,
  });

  // Calculate combined metrics from current eye metrics and watch data
  const combinedMetrics = useMemo(() => {
    if (!metrics) return null;
    const combined = calculateCombinedFlow(
      metrics,
      effectiveHrvMetrics,
      effectiveHeartRate,
      calibrationData?.workingBaseline ?? null,
      effectiveEDA !== null ? { scl: effectiveEDA } : null
    );
    // Use smoothed score from flow detector
    return {
      ...combined,
      combinedFlowScore: flowState.smoothedScore,
    };
  }, [metrics, effectiveHeartRate, effectiveHrvMetrics, effectiveEDA, calibrationData, flowState.smoothedScore]);

  const handleStart = async () => {
    const streamStarted = await startStream();
    if (streamStarted) {
      setIsTracking(true);
    }
  };

  const handleStop = () => {
    setIsTracking(false);
    stopStream();
    setMetricsHistory([]);
    // Reset flow detector state
    flowDetectorRef.current = createFlowDetectorState();
    setFlowState(createFlowDetectorState());
  };

  const handleCalibrate = async () => {
    // Need camera stream for calibration
    if (!cameraState.stream) {
      const streamStarted = await startStream();
      if (!streamStarted) return;
    }
    // Stop tracking during calibration
    setIsTracking(false);
    startCalibration();
  };

  const handleCancelCalibration = () => {
    cancelCalibration();
    // Resume tracking if camera is still running
    if (cameraState.stream) {
      setIsTracking(true);
    }
  };

  const handleCalibrationDone = () => {
    cancelCalibration(); // resets to idle, hides overlay
    setIsTracking(true); // resume eye tracking with new calibration
  };

  const getFlowColor = (value: number) => {
    if (value >= 0.7) return "#22c55e";
    if (value >= 0.5) return "#eab308";
    return "#ef4444";
  };

  const getFlowLabel = (value: number, inFlow: boolean) => {
    if (inFlow) return "In Flow";
    if (value >= 0.65) return "Entering Flow...";
    if (value >= 0.5) return "Moderate Focus";
    if (value >= 0.35) return "Light Focus";
    return "Distracted";
  };

  return (
    <main style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Calibration Overlay */}
      <CalibrationOverlay state={calibrationState} onCancel={handleCancelCalibration} onDone={handleCalibrationDone} />

      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Flow Detector</h1>
      <p style={{ color: "#888", marginBottom: "2rem" }}>
        Multi-sensor flow state detection using eye tracking + heart rate
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
        {/* Left Column - Video & Controls */}
        <div>
          {/* Video Feed */}
          <div
            style={{
              position: "relative",
              aspectRatio: "16/9",
              backgroundColor: "#1a1a1a",
              borderRadius: "12px",
              overflow: "hidden",
              border: "1px solid #333",
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
              }}
            />
            {!cameraState.stream && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#666",
                }}
              >
                Camera preview
              </div>
            )}
          </div>

          {/* Camera Controls */}
          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {!cameraState.stream ? (
              <button
                onClick={handleStart}
                disabled={cameraState.isLoading}
                style={{
                  padding: "0.75rem 1.5rem",
                  fontSize: "1rem",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: cameraState.isLoading ? "wait" : "pointer",
                  opacity: cameraState.isLoading ? 0.7 : 1,
                }}
              >
                {cameraState.isLoading ? "Starting..." : "Start Eye Tracking"}
              </button>
            ) : (
              <button
                onClick={handleStop}
                style={{
                  padding: "0.75rem 1.5rem",
                  fontSize: "1rem",
                  backgroundColor: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Stop Tracking
              </button>
            )}

            {/* Calibration Button */}
            <button
              onClick={handleCalibrate}
              disabled={isCalibrating}
              style={{
                padding: "0.75rem 1.5rem",
                fontSize: "1rem",
                backgroundColor: hasCalibration ? "#374151" : "#8b5cf6",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: isCalibrating ? "wait" : "pointer",
                opacity: isCalibrating ? 0.7 : 1,
              }}
            >
              {hasCalibration ? "Recalibrate" : "Calibrate"}
            </button>
          </div>

          {/* Calibration Status */}
          {hasCalibration && calibrationData && (
            <div
              style={{
                marginTop: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.75rem",
                color: "#888",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#22c55e",
                }}
              />
              Calibrated {formatCalibrationDate(calibrationData)}
              <button
                onClick={clearStoredCalibration}
                style={{
                  marginLeft: "0.5rem",
                  padding: "0.25rem 0.5rem",
                  backgroundColor: "transparent",
                  color: "#666",
                  border: "1px solid #444",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.7rem",
                }}
              >
                Clear
              </button>
            </div>
          )}

          {cameraState.error && (
            <p style={{ color: "#ef4444", marginTop: "1rem" }}>{cameraState.error}</p>
          )}
          {trackingState.error && (
            <p style={{ color: "#ef4444", marginTop: "0.5rem" }}>{trackingState.error}</p>
          )}

          {/* Watch Stream Panel (Galaxy Watch via relay server) */}
          <div
            style={{
              marginTop: "1.5rem",
              padding: "1rem",
              backgroundColor: "#1a1a1a",
              borderRadius: "12px",
              border: watchStreamConnected ? "1px solid #10b981" : "1px solid #333",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
              }}
            >
              <span style={{ fontWeight: "bold" }}>Galaxy Watch (Direct)</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                  color: watchStreamConnected ? "#10b981" : "#888",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: watchStreamConnected
                      ? "#10b981"
                      : isRelayConnected
                        ? "#eab308"
                        : "#666",
                  }}
                />
                {watchStreamConnected
                  ? watchStreamDeviceName ?? "Watch Connected"
                  : isRelayConnected
                    ? "Relay connected, waiting for watch..."
                    : "Relay offline"}
              </span>
            </div>

            <div style={{ fontSize: "0.75rem", color: "#666" }}>
              {isRelayConnected
                ? "Relay server running. Start watch app to stream HR + EDA."
                : "Run: npm run watch-server"}
            </div>

            {watchStreamError && (
              <p style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.5rem" }}>
                {watchStreamError}
              </p>
            )}

            {/* Watch Stream Metrics */}
            {watchStreamConnected && (
              <div
                style={{
                  marginTop: "1rem",
                  display: "grid",
                  gridTemplateColumns: currentSCL !== null ? "1fr 1fr 1fr" : "1fr 1fr",
                  gap: "0.5rem",
                }}
              >
                <div
                  style={{
                    padding: "0.75rem",
                    backgroundColor: "#0a0a0a",
                    borderRadius: "8px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>Heart Rate</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#ef4444" }}>
                    {watchStreamHeartRate ?? "--"}
                    <span style={{ fontSize: "0.75rem", fontWeight: "normal" }}> BPM</span>
                  </div>
                </div>
                <div
                  style={{
                    padding: "0.75rem",
                    backgroundColor: "#0a0a0a",
                    borderRadius: "8px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>RMSSD</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#10b981" }}>
                    {watchStreamHrvMetrics?.rmssd?.toFixed(0) ?? "--"}
                    <span style={{ fontSize: "0.75rem", fontWeight: "normal" }}> ms</span>
                  </div>
                </div>
                {currentSCL !== null && (
                  <div
                    style={{
                      padding: "0.75rem",
                      backgroundColor: "#0a0a0a",
                      borderRadius: "8px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "0.75rem", color: "#888" }}>SCL</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#f59e0b" }}>
                      {currentSCL.toFixed(1)}
                      <span style={{ fontSize: "0.75rem", fontWeight: "normal" }}> {"\u00B5S"}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Right Column - Metrics Display */}
        <div>
          {combinedMetrics ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* Flow Indicator */}
              <div
                style={{
                  padding: "1.5rem",
                  backgroundColor: "#1a1a1a",
                  borderRadius: "12px",
                  border: flowState.inFlow ? "2px solid #22c55e" : "1px solid #333",
                  textAlign: "center",
                  transition: "border-color 0.5s",
                }}
              >
                <div style={{ fontSize: "0.875rem", color: "#888", marginBottom: "0.5rem" }}>
                  {combinedMetrics.hasEdaData
                    ? "Combined Flow State (Eye + HRV + EDA)"
                    : combinedMetrics.hasWatchData
                      ? "Combined Flow State (Eye + HRV)"
                      : "Flow State (Eye Only)"}
                  {hasCalibration && " • Calibrated"}
                </div>
                <div
                  style={{
                    fontSize: "3rem",
                    fontWeight: "bold",
                    color: getFlowColor(combinedMetrics.combinedFlowScore),
                  }}
                >
                  {(combinedMetrics.combinedFlowScore * 100).toFixed(0)}%
                </div>
                <div
                  style={{
                    fontSize: "1.25rem",
                    color: getFlowColor(combinedMetrics.combinedFlowScore),
                    marginTop: "0.25rem",
                  }}
                >
                  {getFlowLabel(combinedMetrics.combinedFlowScore, flowState.inFlow)}
                </div>
                {flowState.inFlow && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#22c55e",
                      marginTop: "0.5rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: "#22c55e",
                        animation: "pulse 2s infinite",
                      }}
                    />
                    Flow confirmed • {(flowState.confidence * 100).toFixed(0)}% confidence
                  </div>
                )}
                {!flowState.inFlow && flowState.flowOnsetTime && (
                  <div style={{ fontSize: "0.75rem", color: "#eab308", marginTop: "0.5rem" }}>
                    Building focus... {Math.floor((Date.now() - flowState.flowOnsetTime) / 1000)}s
                  </div>
                )}
                {!combinedMetrics.hasWatchData && !flowState.inFlow && (
                  <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.5rem" }}>
                    Connect watch for combined metrics
                  </div>
                )}
              </div>

              {/* Detailed Metrics */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1rem",
                }}
              >
                <MetricCard
                  label="Blink Rate"
                  value={`${combinedMetrics.blinkRate.toFixed(1)}/min`}
                  subtitle="Optimal: 3-15"
                />
                <MetricCard
                  label="Gaze Stability"
                  value={`${(combinedMetrics.gazeStability * 100).toFixed(0)}%`}
                  subtitle="Higher is better"
                />
                <MetricCard
                  label="Eye Openness"
                  value={`${(combinedMetrics.averageEAR * 100).toFixed(0)}%`}
                  subtitle="EAR average"
                />
                <MetricCard
                  label="Eye Flow"
                  value={`${(combinedMetrics.eyeFlowIndicator * 100).toFixed(0)}%`}
                  subtitle="Eye-only score"
                />
                {combinedMetrics.rmssd !== null && (
                  <MetricCard
                    label="RMSSD"
                    value={`${combinedMetrics.rmssd.toFixed(0)}ms`}
                    subtitle="HRV metric"
                  />
                )}
                {combinedMetrics.sdnn !== null && (
                  <MetricCard
                    label="SDNN"
                    value={`${combinedMetrics.sdnn.toFixed(0)}ms`}
                    subtitle="HRV variability"
                  />
                )}
                {combinedMetrics.scl !== null && (
                  <MetricCard
                    label="SCL"
                    value={`${combinedMetrics.scl.toFixed(1)} \u00B5S`}
                    subtitle="Skin conductance"
                  />
                )}
              </div>

              {/* Calibration Info */}
              {hasCalibration && calibrationData && (
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    backgroundColor: "#1a1a1a",
                    borderRadius: "8px",
                    border: "1px solid #333",
                    fontSize: "0.75rem",
                    color: "#888",
                  }}
                >
                  <div style={{ marginBottom: "0.25rem", color: "#aaa" }}>
                    Personal Thresholds
                  </div>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <span>Blink: {calibrationData.ear.blinkThreshold.toFixed(3)}</span>
                    <span>Open EAR: {calibrationData.ear.openEyeEAR.toFixed(3)}</span>
                    <span>
                      Gaze Center: ({calibrationData.gaze.center.x.toFixed(2)},{" "}
                      {calibrationData.gaze.center.y.toFixed(2)})
                    </span>
                  </div>
                </div>
              )}

              {/* History Graph */}
              {metricsHistory.length > 1 && (
                <div
                  style={{
                    padding: "1rem",
                    backgroundColor: "#1a1a1a",
                    borderRadius: "12px",
                    border: "1px solid #333",
                  }}
                >
                  <div style={{ fontSize: "0.875rem", color: "#888", marginBottom: "0.75rem" }}>
                    Flow History
                  </div>
                  <div style={{ display: "flex", alignItems: "end", gap: "4px", height: "60px" }}>
                    {metricsHistory.map((m, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: `${m.combinedFlowScore * 100}%`,
                          backgroundColor: getFlowColor(m.combinedFlowScore),
                          borderRadius: "2px",
                          minHeight: "4px",
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: "2rem",
                backgroundColor: "#1a1a1a",
                borderRadius: "12px",
                border: "1px solid #333",
                textAlign: "center",
                color: "#666",
              }}
            >
              {trackingState.isRunning
                ? "Measuring... Look at the camera"
                : hasCalibration
                ? "Start tracking to see metrics"
                : "Calibrate first for accurate readings"}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        padding: "1rem",
        backgroundColor: "#1a1a1a",
        borderRadius: "8px",
        border: "1px solid #333",
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "#888" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem" }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>{subtitle}</div>
    </div>
  );
}
