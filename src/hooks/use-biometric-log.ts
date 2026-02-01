/**
 * React hook for browser-side biometric session logging.
 *
 * Buffers events in memory and flushes to IndexedDB every 5 seconds.
 * Also flushes on visibilitychange (tab switch / laptop close).
 * POSTs eye metrics to the sensor fusion server for correlation.
 * Provides download as JSONL and a marker/annotation API.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LogEvent,
  HREvent,
  EDAEvent,
  FlowEvent,
  MarkerEvent,
  AnnotationEvent,
} from "@/lib/logging/biometric-db";
import {
  openDatabase,
  saveSession,
  writeEvents,
  exportSessionAsJSONL,
} from "@/lib/logging/biometric-db";

const FLUSH_INTERVAL_MS = 5000;
const SERVER_URL = "http://localhost:8765";

export interface EyeMetricsForServer {
  window_start: number;
  window_end: number;
  blink_rate: number;
  gaze_stability: number;
  average_ear: number;
  eye_flow_indicator: number;
  frame_count: number;
}

export interface UseBiometricLogReturn {
  logHR: (bpm: number, ibi: number | null, rmssd: number | null, sdnn: number | null) => void;
  logEDA: (scl: number) => void;
  logFlow: (score: number, smoothedScore: number, tier: string, inFlow: boolean) => void;
  logEyeMetrics: (metrics: EyeMetricsForServer) => void;
  logMarker: (tag?: string) => void;
  logAnnotation: (label: "high" | "mid" | "low" | "wrong", startTime: number, endTime: number) => void;
  downloadSession: () => Promise<void>;
  eventCount: number;
  sessionId: string;
  serverSessionId: string | null;
}

export function useBiometricLog(): UseBiometricLogReturn {
  const sessionIdRef = useRef<string>(new Date().toISOString());
  const bufferRef = useRef<LogEvent[]>([]);
  const eventCountRef = useRef(0);
  const [eventCount, setEventCount] = useState(0);
  const dbReadyRef = useRef(false);

  // Server session tracking
  const serverSessionIdRef = useRef<string | null>(null);
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  const eyeMetricsBufferRef = useRef<EyeMetricsForServer[]>([]);

  // Initialize DB and save session metadata
  useEffect(() => {
    openDatabase()
      .then(() => {
        dbReadyRef.current = true;
        return saveSession({
          sessionId: sessionIdRef.current,
          startTime: Date.now(),
          deviceName: null,
          sensors: [],
        });
      })
      .catch((err) => console.error("[biometric-log] DB init failed:", err));

    // Create server session
    createServerSession();

    return () => {
      // Deactivate session on unmount
      deactivateServerSession();
    };
  }, []);

  /**
   * Create a session on the sensor fusion server
   */
  async function createServerSession() {
    try {
      const response = await fetch(`${SERVER_URL}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        console.error("[biometric-log] Failed to create server session:", response.status);
        return;
      }

      const data = await response.json();
      serverSessionIdRef.current = data.session_id;
      setServerSessionId(data.session_id);
      console.log("[biometric-log] Server session created:", data.session_id);

      // Activate the session for watch batch storage
      await activateServerSession(data.session_id);
    } catch (err) {
      console.error("[biometric-log] Failed to create server session:", err);
    }
  }

  /**
   * Activate the session on the server for watch batch storage
   */
  async function activateServerSession(sessionId: string) {
    try {
      await fetch(`${SERVER_URL}/api/session/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch (err) {
      console.error("[biometric-log] Failed to activate server session:", err);
    }
  }

  /**
   * Deactivate the session on the server
   */
  async function deactivateServerSession() {
    try {
      await fetch(`${SERVER_URL}/api/session/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: null }),
      });
    } catch {
      // Ignore errors on cleanup
    }
  }

  // Flush buffer to IndexedDB
  const flush = useCallback(async () => {
    if (!dbReadyRef.current || bufferRef.current.length === 0) return;
    const batch = bufferRef.current.splice(0);
    try {
      await writeEvents(batch);
    } catch (err) {
      console.error("[biometric-log] Flush failed:", err);
      // Put events back at front of buffer so they aren't lost
      bufferRef.current.unshift(...batch);
    }
  }, []);

  // Flush eye metrics to server
  const flushEyeMetrics = useCallback(async () => {
    if (!serverSessionIdRef.current || eyeMetricsBufferRef.current.length === 0) return;

    const batch = eyeMetricsBufferRef.current.splice(0);

    for (let i = 0; i < batch.length; i++) {
      const metrics = batch[i];
      try {
        await fetch(`${SERVER_URL}/api/sensors/eye`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: serverSessionIdRef.current,
            ...metrics,
          }),
        });
      } catch (err) {
        console.error("[biometric-log] Failed to POST eye metrics:", err);
        // Put back this metric AND all remaining ones
        eyeMetricsBufferRef.current.unshift(...batch.slice(i));
        break; // Stop trying if server is down
      }
    }
  }, []);

  // Periodic flush + visibilitychange flush
  useEffect(() => {
    const interval = setInterval(() => {
      flush();
      flushEyeMetrics();
    }, FLUSH_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
        flushEyeMetrics();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      // Final flush on unmount
      flush();
      flushEyeMetrics();
    };
  }, [flush, flushEyeMetrics]);

  const pushEvent = useCallback((event: LogEvent) => {
    bufferRef.current.push(event);
    eventCountRef.current += 1;
    setEventCount(eventCountRef.current);
  }, []);

  const logHR = useCallback(
    (bpm: number, ibi: number | null, rmssd: number | null, sdnn: number | null) => {
      const event: HREvent = {
        type: "hr",
        sessionId: sessionIdRef.current,
        timestamp: Date.now(),
        bpm,
        ibi,
        rmssd,
        sdnn,
      };
      pushEvent(event);
    },
    [pushEvent]
  );

  const logEDA = useCallback(
    (scl: number) => {
      const event: EDAEvent = {
        type: "eda",
        sessionId: sessionIdRef.current,
        timestamp: Date.now(),
        scl,
      };
      pushEvent(event);
    },
    [pushEvent]
  );

  const logFlow = useCallback(
    (score: number, smoothedScore: number, tier: string, inFlow: boolean) => {
      const event: FlowEvent = {
        type: "flow",
        sessionId: sessionIdRef.current,
        timestamp: Date.now(),
        score,
        smoothedScore,
        tier,
        inFlow,
      };
      pushEvent(event);
    },
    [pushEvent]
  );

  const logEyeMetrics = useCallback((metrics: EyeMetricsForServer) => {
    eyeMetricsBufferRef.current.push(metrics);
  }, []);

  const logMarker = useCallback(
    (tag?: string) => {
      const event: MarkerEvent = {
        type: "marker",
        sessionId: sessionIdRef.current,
        timestamp: Date.now(),
        ...(tag ? { tag } : {}),
      };
      pushEvent(event);
    },
    [pushEvent]
  );

  const logAnnotation = useCallback(
    (label: "high" | "mid" | "low" | "wrong", startTime: number, endTime: number) => {
      const now = Date.now();
      const event: AnnotationEvent = {
        type: "annotation",
        sessionId: sessionIdRef.current,
        timestamp: now,
        startTime,
        endTime,
        label,
        annotatedAt: now,
      };
      pushEvent(event);
    },
    [pushEvent]
  );

  const downloadSession = useCallback(async () => {
    // Flush pending buffer first
    await flush();
    try {
      const jsonl = await exportSessionAsJSONL(sessionIdRef.current);
      if (!jsonl) {
        console.warn("[biometric-log] No events to download");
        return;
      }
      const blob = new Blob([jsonl], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flow-session-${sessionIdRef.current.replace(/[:.]/g, "-")}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[biometric-log] Download failed:", err);
    }
  }, [flush]);

  return {
    logHR,
    logEDA,
    logFlow,
    logEyeMetrics,
    logMarker,
    logAnnotation,
    downloadSession,
    eventCount,
    sessionId: sessionIdRef.current,
    serverSessionId,
  };
}
