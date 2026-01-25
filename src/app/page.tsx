"use client";

import { useEffect, useState, useMemo } from "react";
import { useCameraStream } from "@/hooks/use-camera-stream";
import { useEyeTracking } from "@/hooks/use-eye-tracking";
import { useSensorServer } from "@/hooks/use-sensor-server";
import { calculateCombinedFlow } from "@/lib/biometrics/flow-calculator";
import type { AggregatedEyeMetrics } from "@/lib/mediapipe/types";
import type { CombinedFlowMetrics } from "@/lib/biometrics/types";

export default function Home() {
  const { state: cameraState, videoRef, startStream, stopStream } = useCameraStream();
  const [isTracking, setIsTracking] = useState(false);
  const [metricsHistory, setMetricsHistory] = useState<CombinedFlowMetrics[]>([]);

  // Watch connection state
  const [serverIp, setServerIp] = useState("");
  const {
    isConnected: watchConnected,
    heartRate,
    hrv,
    error: watchError,
    connect: connectWatch,
    disconnect: disconnectWatch,
  } = useSensorServer();

  const { state: trackingState, metrics, start, stop } = useEyeTracking({
    videoElement: videoRef.current,
    enabled: isTracking,
    onMetrics: (m) => {
      // Calculate combined flow when we get eye metrics
      const combined = calculateCombinedFlow(m, hrv, heartRate);
      setMetricsHistory((prev) => [...prev.slice(-11), combined]);
    },
  });

  // Calculate combined metrics from current eye metrics and watch data
  const combinedMetrics = useMemo(() => {
    if (!metrics) return null;
    return calculateCombinedFlow(metrics, hrv, heartRate);
  }, [metrics, hrv, heartRate]);

  const handleStart = async () => {
    const streamStarted = await startStream();
    if (streamStarted) {
      setIsTracking(true);
    }
  };

  const handleStop = () => {
    setIsTracking(false);
    stop();
    stopStream();
    setMetricsHistory([]);
  };

  const handleWatchConnect = () => {
    if (serverIp.trim()) {
      connectWatch(serverIp.trim());
    }
  };

  const getFlowColor = (value: number) => {
    if (value >= 0.7) return "#22c55e";
    if (value >= 0.5) return "#eab308";
    return "#ef4444";
  };

  const getFlowLabel = (value: number) => {
    if (value >= 0.7) return "In Flow";
    if (value >= 0.5) return "Moderate Focus";
    return "Distracted";
  };

  return (
    <main style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Flow Detector</h1>
      <p style={{ color: "#888", marginBottom: "2rem" }}>
        Multi-sensor flow state detection using eye tracking + heart rate variability
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
          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
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
          </div>

          {cameraState.error && (
            <p style={{ color: "#ef4444", marginTop: "1rem" }}>{cameraState.error}</p>
          )}
          {trackingState.error && (
            <p style={{ color: "#ef4444", marginTop: "0.5rem" }}>{trackingState.error}</p>
          )}

          {/* Watch Connection Panel */}
          <div
            style={{
              marginTop: "1.5rem",
              padding: "1rem",
              backgroundColor: "#1a1a1a",
              borderRadius: "12px",
              border: "1px solid #333",
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
              <span style={{ fontWeight: "bold" }}>Galaxy Watch</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                  color: watchConnected ? "#22c55e" : "#888",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: watchConnected ? "#22c55e" : "#666",
                  }}
                />
                {watchConnected ? "Connected" : "Disconnected"}
              </span>
            </div>

            {!watchConnected ? (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder="Fold IP (e.g., 192.168.1.100)"
                  style={{
                    flex: 1,
                    padding: "0.5rem 0.75rem",
                    backgroundColor: "#0a0a0a",
                    border: "1px solid #333",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "0.875rem",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleWatchConnect();
                  }}
                />
                <button
                  onClick={handleWatchConnect}
                  disabled={!serverIp.trim()}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: serverIp.trim() ? "#3b82f6" : "#333",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: serverIp.trim() ? "pointer" : "not-allowed",
                    fontSize: "0.875rem",
                  }}
                >
                  Connect
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ flex: 1, fontSize: "0.875rem", color: "#888" }}>
                  {serverIp}
                </span>
                <button
                  onClick={disconnectWatch}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "#ef4444",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Disconnect
                </button>
              </div>
            )}

            {watchError && (
              <p style={{ color: "#ef4444", fontSize: "0.75rem", marginTop: "0.5rem" }}>
                {watchError}
              </p>
            )}

            {/* Watch Metrics */}
            {watchConnected && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.75rem",
                  marginTop: "1rem",
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
                    {heartRate ?? "--"}
                    <span style={{ fontSize: "0.875rem", fontWeight: "normal" }}> BPM</span>
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
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>HRV (RMSSD)</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#8b5cf6" }}>
                    {hrv ? hrv.rmssd.toFixed(1) : "--"}
                    <span style={{ fontSize: "0.875rem", fontWeight: "normal" }}> ms</span>
                  </div>
                </div>
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
                  border: "1px solid #333",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "0.875rem", color: "#888", marginBottom: "0.5rem" }}>
                  {combinedMetrics.hasWatchData ? "Combined Flow State" : "Flow State (Eye Only)"}
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
                  {getFlowLabel(combinedMetrics.combinedFlowScore)}
                </div>
                {!combinedMetrics.hasWatchData && (
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
              </div>

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
                ? "Calibrating... Look at the camera"
                : "Start tracking to see metrics"}
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
