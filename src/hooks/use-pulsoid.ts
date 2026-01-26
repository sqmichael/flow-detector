"use client";

/**
 * Pulsoid WebSocket Hook
 *
 * Connects to Pulsoid's WebSocket API to receive real-time heart rate
 * data from Galaxy Watch (or any Pulsoid-supported device).
 *
 * API Docs: https://docs.pulsoid.net/read-heart-rate/read-heart-rate-via-websocket
 */

import { useCallback, useEffect, useRef, useState } from "react";

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log("[Pulsoid]", ...args);
  }
}

/**
 * Pulsoid WebSocket message format
 */
interface PulsoidMessage {
  measured_at: number;
  data: {
    heart_rate: number;
  };
}

interface PulsoidState {
  isConnected: boolean;
  error: string | null;
  heartRate: number | null;
  lastUpdate: number | null;
}

interface UsePulsoidOptions {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
}

interface UsePulsoidReturn {
  /** Current connection state */
  state: PulsoidState;
  /** Connect to Pulsoid with access token */
  connect: (accessToken: string) => void;
  /** Disconnect from Pulsoid */
  disconnect: () => void;
  /** Current heart rate in BPM */
  heartRate: number | null;
  /** Whether connected */
  isConnected: boolean;
  /** Error message if any */
  error: string | null;
}

const PULSOID_WS_URL = "wss://dev.pulsoid.net/api/v1/data/real_time";

export function usePulsoid(options: UsePulsoidOptions = {}): UsePulsoidReturn {
  const {
    autoReconnect = true,
    reconnectDelay = 1000,
    maxReconnectDelay = 30000,
  } = options;

  const [state, setState] = useState<PulsoidState>({
    isConnected: false,
    error: null,
    heartRate: null,
    lastUpdate: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentDelayRef = useRef<number>(reconnectDelay);
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
      const data = JSON.parse(event.data) as PulsoidMessage;

      messageCountRef.current++;
      if (messageCountRef.current <= 3) {
        log("Received message:", data);
      }

      if (data.data?.heart_rate !== undefined) {
        const hr = data.data.heart_rate;
        const timestamp = data.measured_at || Date.now();

        if (messageCountRef.current <= 10 || messageCountRef.current % 30 === 0) {
          log(`Heart rate: ${hr} BPM`);
        }

        setState((prev) => ({
          ...prev,
          heartRate: hr,
          lastUpdate: timestamp,
        }));
      }
    } catch (err) {
      log("Error parsing message:", err, "Raw:", event.data);
    }
  }, []);

  const connect = useCallback(
    (accessToken: string) => {
      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      // Reset state
      tokenRef.current = accessToken;
      currentDelayRef.current = reconnectDelay;
      messageCountRef.current = 0;

      const url = `${PULSOID_WS_URL}?access_token=${accessToken}`;
      log(`Connecting to Pulsoid...`);

      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: null,
      }));

      try {
        const ws = new WebSocket(url);

        ws.onopen = () => {
          log("Connected to Pulsoid successfully!");
          currentDelayRef.current = reconnectDelay; // Reset delay on successful connection
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
            error: "Connection error. Check your Pulsoid token.",
          }));
        };

        ws.onclose = (event) => {
          log(`WebSocket closed: code=${event.code}, reason=${event.reason || "none"}`);
          setState((prev) => ({
            ...prev,
            isConnected: false,
          }));

          // Auto-reconnect with exponential backoff
          if (autoReconnect && tokenRef.current) {
            const delay = currentDelayRef.current;
            log(`Reconnecting in ${delay}ms...`);

            reconnectTimeoutRef.current = setTimeout(() => {
              if (tokenRef.current) {
                connect(tokenRef.current);
              }
            }, delay);

            // Exponential backoff
            currentDelayRef.current = Math.min(delay * 2, maxReconnectDelay);
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
    [autoReconnect, reconnectDelay, maxReconnectDelay, handleMessage]
  );

  const disconnect = useCallback(() => {
    log("Disconnecting...");

    // Clear reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear token to prevent reconnection
    tokenRef.current = null;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState({
      isConnected: false,
      error: null,
      heartRate: null,
      lastUpdate: null,
    });
  }, []);

  return {
    state,
    connect,
    disconnect,
    heartRate: state.heartRate,
    isConnected: state.isConnected,
    error: state.error,
  };
}
