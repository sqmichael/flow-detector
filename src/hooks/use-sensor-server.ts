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
  const messageCountRef = useRef<number>(0);

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
      // SensorServer sends: {"values": [...], "timestamp": number, "accuracy": number}
      const data = JSON.parse(event.data);

      // Log first few messages for debugging
      messageCountRef.current++;
      if (messageCountRef.current <= 3) {
        log("Received message:", data);
      }

      const timestamp = data.timestamp || Date.now();

      // For heart rate sensor: values[0] is BPM
      // For accelerometer (testing): values is [x, y, z]
      if (data.values && data.values.length > 0) {
        // When connected to heart_rate sensor, first value is BPM
        // For now, we're testing with accelerometer, so just log
        const firstValue = data.values[0];

        // If this looks like a heart rate (reasonable BPM range 30-220)
        if (firstValue >= 30 && firstValue <= 220 && data.values.length === 1) {
          log(`Heart rate: ${firstValue} BPM`);
          setState((prev) => ({
            ...prev,
            heartRate: Math.round(firstValue),
            lastUpdate: timestamp,
          }));
        }

        // If there's a second value that could be IBI (200-2000ms range)
        if (data.values.length > 1) {
          const possibleIBI = data.values[1];
          if (possibleIBI >= 200 && possibleIBI <= 2000) {
            log(`IBI: ${possibleIBI}ms`);
            hrvCalculatorRef.current.addIBI(possibleIBI, timestamp);

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
      // Check if there's a port after the host (look for colon after the protocol)
      const hostPart = url.replace(/^wss?:\/\//, "");
      if (!hostPart.includes(":")) {
        url = `${url}:8080`;
      }

      // SensorServer requires a specific path with sensor type
      // Format: ws://ip:port/sensor/connect?type=android.sensor.xxxxx
      // For testing, we'll use accelerometer since most phones have it
      // TODO: Change to heart_rate when watch app is set up
      const baseUrl = url;
      url = `${url}/sensor/connect?type=android.sensor.accelerometer`;

      log(`Final WebSocket URL: ${url}`);
      log(`Base URL for reference: ${baseUrl}`);

      serverUrlRef.current = url;
      log(`Connecting to ${url}...`);

      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: null,
      }));

      try {
        log(`Creating WebSocket connection to: ${url}`);
        const ws = new WebSocket(url);

        ws.onopen = () => {
          log("Connected to SensorServer successfully!");
          setState((prev) => ({
            ...prev,
            isConnected: true,
            error: null,
          }));
        };

        ws.onmessage = handleMessage;

        ws.onerror = (event) => {
          log("WebSocket error event:", event);
          // Check if it's a mixed content issue
          if (typeof window !== "undefined" && window.location.protocol === "https:") {
            setState((prev) => ({
              ...prev,
              error: "Cannot connect: browser blocks ws:// from https:// pages. Use http://localhost:3000 instead.",
            }));
          } else {
            setState((prev) => ({
              ...prev,
              error: "Connection error. Check if SensorServer is running and IP is correct.",
            }));
          }
        };

        ws.onclose = (event) => {
          log(`WebSocket closed: code=${event.code}, reason=${event.reason || "none"}`);
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
        log("WebSocket object created, waiting for connection...");
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
