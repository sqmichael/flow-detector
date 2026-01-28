/**
 * React hook for browser-side biometric session logging.
 *
 * Buffers events in memory and flushes to IndexedDB every 5 seconds.
 * Also flushes on visibilitychange (tab switch / laptop close).
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

export interface UseBiometricLogReturn {
  logHR: (bpm: number, ibi: number | null, rmssd: number | null, sdnn: number | null) => void;
  logEDA: (scl: number) => void;
  logFlow: (score: number, smoothedScore: number, tier: string, inFlow: boolean) => void;
  logMarker: (tag?: string) => void;
  logAnnotation: (label: "high" | "mid" | "low" | "wrong", startTime: number, endTime: number) => void;
  downloadSession: () => Promise<void>;
  eventCount: number;
  sessionId: string;
}

export function useBiometricLog(): UseBiometricLogReturn {
  const sessionIdRef = useRef<string>(new Date().toISOString());
  const bufferRef = useRef<LogEvent[]>([]);
  const eventCountRef = useRef(0);
  const [eventCount, setEventCount] = useState(0);
  const dbReadyRef = useRef(false);

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
  }, []);

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

  // Periodic flush + visibilitychange flush
  useEffect(() => {
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      // Final flush on unmount
      flush();
    };
  }, [flush]);

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
    logMarker,
    logAnnotation,
    downloadSession,
    eventCount,
    sessionId: sessionIdRef.current,
  };
}
