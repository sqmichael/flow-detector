"use client";

/**
 * SensorServer WebSocket Hook
 *
 * Connects to SensorServer app running on Samsung Fold to receive
 * heart rate and IBI data from Galaxy Watch.
 *
 * SensorServer URL format: ws://<fold-ip>:8080
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HRVCalculator } from "@/lib/biometrics/hrv-calculator";
import type {
  HRVMetrics,
  SensorServerMessage,
  SensorServerState,
} from "@/lib/biometrics/types";

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[SensorServer Hook]", ...args);
  }
}

interface UseSensorServerOptions {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;
}

interface UseSensorServerReturn {
  /** Current connection state */
  state: SensorServerState;
  /** Connect to SensorServer */
  connect: (serverUrl: string) => void;
  /** Disconnect from SensorServer */
  disconnect: () => void;
  /** Current heart rate in BPM */
  heartRate: number | null;
  /** Current HRV metrics */
  hrv: HRVMetrics | null;
  /** Whether connected */
  isConnected: boolean;
  /** Error message if any */
  error: string | null;
}

export function useSensorServer(
  options: UseSensorServerOptions = {}
): UseSensorServerReturn {
  const { autoReconnect = false, reconnectDelay = 3000 } = options;

  const [state, setState] = useState<SensorServerState>({
    isConnected: false,
    error: null,
    heartRate: null,
    hrv: null,
    lastUpdate: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const hrvCalculatorRef = useRef<HRVCalculator>(new HRVCalculator());
  const serverUrlRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as SensorServerMessage;
      log("Received message:", data);

      const timestamp = data.timestamp || Date.now();

      // Handle heart rate data
      if (data.sensor === "heart_rate" && data.values && data.values.length > 0) {
        const bpm = data.values[0];
        log(`Heart rate: ${bpm} BPM`);

        setState((prev) => ({
          ...prev,
          heartRate: bpm,
          lastUpdate: timestamp,
        }));
      }

      // Handle IBI/PPG data for HRV calculation
      // SensorServer may send this as "ppg" or with heart_rate containing IBI
      if (
        (data.sensor === "ppg" || data.sensor === "heart_rate") &&
        data.values &&
        data.values.length > 1
      ) {
        // Some SensorServer implementations send [HR, IBI] format
        const ibi = data.values[1];
        if (ibi > 0) {
          log(`IBI: ${ibi}ms`);
          hrvCalculatorRef.current.addIBI(ibi, timestamp);

          // Calculate HRV after adding new IBI
          const hrvMetrics = hrvCalculatorRef.current.calculate();
          if (hrvMetrics) {
            setState((prev) => ({
              ...prev,
              hrv: hrvMetrics,
              lastUpdate: timestamp,
            }));
          }
        }
      }

      // Also check for explicit IBI sensor
      if (data.sensor === "ibi" && data.values && data.values.length > 0) {
        const ibi = data.values[0];
        log(`IBI (explicit): ${ibi}ms`);
        hrvCalculatorRef.current.addIBI(ibi, timestamp);

        const hrvMetrics = hrvCalculatorRef.current.calculate();
        if (hrvMetrics) {
          setState((prev) => ({
            ...prev,
            hrv: hrvMetrics,
            lastUpdate: timestamp,
          }));
        }
      }
    } catch (err) {
      log("Error parsing message:", err);
    }
  }, []);

  const connect = useCallback(
    (serverUrl: string) => {
      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      // Reset HRV calculator
      hrvCalculatorRef.current.reset();

      // Ensure URL has ws:// prefix
      let url = serverUrl.trim();
      if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
        url = `ws://${url}`;
      }

      // Add default port if not specified
      if (!url.includes(":", 5)) {
        // Skip checking protocol's colon
        url = `${url}:8080`;
      }

      serverUrlRef.current = url;
      log(`Connecting to ${url}...`);

      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: null,
      }));

      try {
        const ws = new WebSocket(url);

        ws.onopen = () => {
          log("Connected to SensorServer");
          setState((prev) => ({
            ...prev,
            isConnected: true,
            error: null,
          }));
        };

        ws.onmessage = handleMessage;

        ws.onerror = (event) => {
          log("WebSocket error:", event);
          setState((prev) => ({
            ...prev,
            error: "Connection error. Check if SensorServer is running.",
          }));
        };

        ws.onclose = (event) => {
          log(`WebSocket closed: code=${event.code}, reason=${event.reason}`);
          setState((prev) => ({
            ...prev,
            isConnected: false,
          }));

          // Auto-reconnect if enabled and we had a server URL
          if (autoReconnect && serverUrlRef.current) {
            log(`Reconnecting in ${reconnectDelay}ms...`);
            reconnectTimeoutRef.current = setTimeout(() => {
              if (serverUrlRef.current) {
                connect(serverUrlRef.current);
              }
            }, reconnectDelay);
          }
        };

        wsRef.current = ws;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to connect";
        log("Connection error:", errorMsg);
        setState((prev) => ({
          ...prev,
          isConnected: false,
          error: errorMsg,
        }));
      }
    },
    [autoReconnect, reconnectDelay, handleMessage]
  );

  const disconnect = useCallback(() => {
    log("Disconnecting...");

    // Clear reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear server URL to prevent reconnection
    serverUrlRef.current = null;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset state
    setState({
      isConnected: false,
      error: null,
      heartRate: null,
      hrv: null,
      lastUpdate: null,
    });

    // Reset HRV calculator
    hrvCalculatorRef.current.reset();
  }, []);

  return {
    state,
    connect,
    disconnect,
    heartRate: state.heartRate,
    hrv: state.hrv,
    isConnected: state.isConnected,
    error: state.error,
  };
}
