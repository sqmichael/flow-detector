"use client";

/**
 * Watch Stream Hook
 *
 * Connects to the watch-relay server (ws://localhost:8765/browser)
 * and receives HR, IBI, and EDA data from the Galaxy Watch.
 *
 * Replaces use-sensor-server.ts with a named-field protocol
 * and exponential backoff reconnection.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { HRVCalculator } from "@/lib/biometrics/hrv-calculator";
import type { HRVMetrics, WatchMessage } from "@/lib/biometrics/types";

const DEBUG = true;
const RELAY_URL = "ws://localhost:8765/browser";

/** Max EDA samples to keep (60 seconds at 1 Hz) */
const EDA_RING_BUFFER_SIZE = 60;

/** If no HR/EDA received for this long, null out metrics */
const STALENESS_TIMEOUT_MS = 10_000;

/** Reconnection backoff config */
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[Watch Stream]", ...args);
  }
}

export interface EdaSample {
  scl: number;
  timestamp: number;
}

export interface WatchStreamState {
  /** Connected to the relay server */
  isRelayConnected: boolean;
  /** Watch is connected to the relay */
  isWatchConnected: boolean;
  /** Watch device name from handshake */
  watchDeviceName: string | null;
  /** Current heart rate in BPM */
  heartRate: number | null;
  /** Latest inter-beat interval in ms */
  latestIBI: number | null;
  /** Calculated HRV metrics */
  hrvMetrics: HRVMetrics | null;
  /** Latest skin conductance level in microsiemens */
  currentSCL: number | null;
  /** Recent EDA samples (ring buffer) */
  edaHistory: EdaSample[];
  /** Last data timestamp */
  lastUpdate: number | null;
  /** Error message */
  error: string | null;
}

export interface UseWatchStreamReturn extends WatchStreamState {
  /** Connect to the relay server (auto-connect by default) */
  connect: () => void;
  /** Disconnect from the relay server */
  disconnect: () => void;
}

export function useWatchStream(): UseWatchStreamReturn {
  const [state, setState] = useState<WatchStreamState>({
    isRelayConnected: false,
    isWatchConnected: false,
    watchDeviceName: null,
    heartRate: null,
    latestIBI: null,
    hrvMetrics: null,
    currentSCL: null,
    edaHistory: [],
    lastUpdate: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const hrvCalculatorRef = useRef<HRVCalculator>(new HRVCalculator());
  const edaBufferRef = useRef<EdaSample[]>([]);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_INITIAL_MS);
  const intentionalCloseRef = useRef(false);
  const lastHrTimestampRef = useRef(0);
  const lastEdaTimestampRef = useRef(0);

  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: WatchMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      log("Malformed JSON from relay, ignoring");
      return;
    }

    switch (msg.type) {
      case "watch_status":
        log(`Watch ${msg.connected ? "connected" : "disconnected"}: ${msg.deviceName || "unknown"}`);
        setState((prev) => ({
          ...prev,
          isWatchConnected: msg.connected,
          watchDeviceName: msg.deviceName,
          // Clear sensor data when watch disconnects
          ...(msg.connected
            ? {}
            : {
                heartRate: null,
                latestIBI: null,
                hrvMetrics: null,
                currentSCL: null,
              }),
        }));
        if (!msg.connected) {
          hrvCalculatorRef.current.reset();
          edaBufferRef.current = [];
          lastHrTimestampRef.current = 0;
          lastEdaTimestampRef.current = 0;
        }
        break;

      case "handshake":
        log(`Watch handshake: ${msg.deviceName}, protocol v${msg.protocolVersion}, sensors: ${msg.sensors.join(", ")}`);
        setState((prev) => ({
          ...prev,
          isWatchConnected: true,
          watchDeviceName: msg.deviceName,
        }));
        break;

      case "hr": {
        const timestamp = msg.timestamp || Date.now();
        lastHrTimestampRef.current = timestamp;

        // Feed IBI into HRV calculator
        let latestIBI: number | null = null;
        if (msg.ibi !== null && msg.ibi >= 200 && msg.ibi <= 2000) {
          hrvCalculatorRef.current.addIBI(msg.ibi, timestamp);
          latestIBI = msg.ibi;
        }

        const hrvMetrics = hrvCalculatorRef.current.calculate();

        setState((prev) => ({
          ...prev,
          heartRate: msg.bpm >= 30 && msg.bpm <= 220 ? Math.round(msg.bpm) : prev.heartRate,
          latestIBI: latestIBI ?? prev.latestIBI,
          hrvMetrics: hrvMetrics ?? prev.hrvMetrics,
          lastUpdate: timestamp,
        }));
        break;
      }

      case "eda": {
        const timestamp = msg.timestamp || Date.now();
        lastEdaTimestampRef.current = timestamp;

        // Add to ring buffer
        const sample: EdaSample = { scl: msg.scl, timestamp };
        edaBufferRef.current.push(sample);
        if (edaBufferRef.current.length > EDA_RING_BUFFER_SIZE) {
          edaBufferRef.current.shift();
        }

        setState((prev) => ({
          ...prev,
          currentSCL: msg.scl,
          edaHistory: [...edaBufferRef.current],
          lastUpdate: timestamp,
        }));
        break;
      }

      default:
        log("Unknown message type:", (msg as { type: string }).type);
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (intentionalCloseRef.current) return;

    const delay = reconnectDelayRef.current;
    log(`Reconnecting in ${delay}ms...`);

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connectToRelay();
    }, delay);

    // Exponential backoff
    reconnectDelayRef.current = Math.min(
      reconnectDelayRef.current * RECONNECT_MULTIPLIER,
      RECONNECT_MAX_MS
    );
  }, []);

  const connectToRelay = useCallback(() => {
    // Clear pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    intentionalCloseRef.current = false;
    log(`Connecting to ${RELAY_URL}...`);

    try {
      const ws = new WebSocket(RELAY_URL);

      ws.onopen = () => {
        log("Connected to relay server");
        reconnectDelayRef.current = RECONNECT_INITIAL_MS; // Reset backoff
        setState((prev) => ({
          ...prev,
          isRelayConnected: true,
          error: null,
        }));
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        // onclose will fire after this, so just log
        log("WebSocket error");
      };

      ws.onclose = (event) => {
        log(`Relay disconnected: code=${event.code}`);
        wsRef.current = null;
        setState((prev) => ({
          ...prev,
          isRelayConnected: false,
          isWatchConnected: false,
        }));
        scheduleReconnect();
      };

      wsRef.current = ws;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to connect";
      log("Connection error:", errorMsg);
      setState((prev) => ({
        ...prev,
        isRelayConnected: false,
        error: errorMsg,
      }));
      scheduleReconnect();
    }
  }, [handleMessage, scheduleReconnect]);

  const connect = useCallback(() => {
    intentionalCloseRef.current = false;
    reconnectDelayRef.current = RECONNECT_INITIAL_MS;
    connectToRelay();
  }, [connectToRelay]);

  const disconnect = useCallback(() => {
    log("Disconnecting...");
    intentionalCloseRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    hrvCalculatorRef.current.reset();
    edaBufferRef.current = [];
    lastHrTimestampRef.current = 0;
    lastEdaTimestampRef.current = 0;

    setState({
      isRelayConnected: false,
      isWatchConnected: false,
      watchDeviceName: null,
      heartRate: null,
      latestIBI: null,
      hrvMetrics: null,
      currentSCL: null,
      edaHistory: [],
      lastUpdate: null,
      error: null,
    });
  }, []);

  // Auto-connect on mount, cleanup on unmount
  useEffect(() => {
    connectToRelay();

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectToRelay]);

  return {
    ...state,
    connect,
    disconnect,
  };
}
