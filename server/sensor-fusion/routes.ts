/**
 * Sensor Fusion API Routes
 *
 * Express routes for the sensor fusion database.
 */

import { Router, Request, Response } from "express";
import {
  createSession,
  getSession,
  listSessions,
  insertEyeMetrics,
  insertWatchBatch,
  insertEvent,
  getFusedWindowsInRange,
  exportSessionAsJSONL,
} from "./database";
import { processPendingFusion, getSessionStats } from "./fusion";
import type {
  CreateSessionRequest,
  EyeMetricsRequest,
  WatchBatchInsert,
  EventInsert,
} from "./types";

export const sensorFusionRouter = Router();

// ── Session Routes ──────────────────────────────────────────────────

/**
 * POST /api/sessions - Create a new session
 */
sensorFusionRouter.post("/sessions", (req: Request, res: Response) => {
  try {
    const body = req.body as CreateSessionRequest;
    const session = createSession({
      device_name: body.device_name,
      calibration_version: body.calibration_version,
    });
    res.json({
      session_id: session.id,
      created_at: session.created_at,
    });
  } catch (err) {
    console.error("[sensor-fusion] Failed to create session:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

/**
 * GET /api/sessions - List recent sessions
 */
sensorFusionRouter.get("/sessions", (_req: Request, res: Response) => {
  try {
    const sessions = listSessions(50);
    res.json({ sessions });
  } catch (err) {
    console.error("[sensor-fusion] Failed to list sessions:", err);
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

/**
 * GET /api/sessions/:id - Get session details
 */
sensorFusionRouter.get("/sessions/:id", (req: Request, res: Response) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const stats = getSessionStats(req.params.id);
    res.json({ session, stats });
  } catch (err) {
    console.error("[sensor-fusion] Failed to get session:", err);
    res.status(500).json({ error: "Failed to get session" });
  }
});

// ── Sensor Data Routes ──────────────────────────────────────────────

/**
 * POST /api/sensors/eye - Receive eye metrics from browser
 */
sensorFusionRouter.post("/sensors/eye", (req: Request, res: Response) => {
  try {
    const body = req.body as EyeMetricsRequest;

    if (!body.session_id) {
      res.status(400).json({ error: "session_id is required" });
      return;
    }

    const row = insertEyeMetrics({
      session_id: body.session_id,
      window_start: body.window_start,
      window_end: body.window_end,
      blink_rate: body.blink_rate,
      gaze_stability: body.gaze_stability,
      average_ear: body.average_ear,
      eye_flow_indicator: body.eye_flow_indicator,
      frame_count: body.frame_count,
      activity_tag: body.activity_tag ?? null,
    });

    res.json({ id: row.id, quality: row.quality });
  } catch (err) {
    console.error("[sensor-fusion] Failed to insert eye metrics:", err);
    res.status(500).json({ error: "Failed to insert eye metrics" });
  }
});

/**
 * POST /api/sensors/watch - Receive watch batch (called internally by relay)
 */
sensorFusionRouter.post("/sensors/watch", (req: Request, res: Response) => {
  try {
    const body = req.body as WatchBatchInsert;

    if (!body.session_id) {
      res.status(400).json({ error: "session_id is required" });
      return;
    }

    const row = insertWatchBatch(body);

    // Trigger fusion after each watch batch
    const fusedWindows = processPendingFusion(body.session_id);

    res.json({
      id: row.id,
      quality: row.quality,
      fused_count: fusedWindows.length,
    });
  } catch (err) {
    console.error("[sensor-fusion] Failed to insert watch batch:", err);
    res.status(500).json({ error: "Failed to insert watch batch" });
  }
});

/**
 * POST /api/events - Record an event (marker, flow transition, etc.)
 */
sensorFusionRouter.post("/events", (req: Request, res: Response) => {
  try {
    const body = req.body as EventInsert;

    if (!body.session_id) {
      res.status(400).json({ error: "session_id is required" });
      return;
    }

    const row = insertEvent(body);
    res.json({ id: row.id });
  } catch (err) {
    console.error("[sensor-fusion] Failed to insert event:", err);
    res.status(500).json({ error: "Failed to insert event" });
  }
});

// ── Fusion Query Routes ─────────────────────────────────────────────

/**
 * GET /api/fusion/time-aligned/:id - Query fused sensor data
 */
sensorFusionRouter.get("/fusion/time-aligned/:id", (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const startTime = req.query.start ? Number(req.query.start) : undefined;
    const endTime = req.query.end ? Number(req.query.end) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 1000;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const windows = getFusedWindowsInRange(sessionId, startTime, endTime, limit, offset);
    const stats = getSessionStats(sessionId);

    res.json({
      session_id: sessionId,
      windows,
      stats,
      query: { start_time: startTime, end_time: endTime, limit, offset },
    });
  } catch (err) {
    console.error("[sensor-fusion] Failed to query fused data:", err);
    res.status(500).json({ error: "Failed to query fused data" });
  }
});

/**
 * POST /api/fusion/process/:id - Trigger fusion processing for a session
 */
sensorFusionRouter.post("/fusion/process/:id", (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;

    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const fusedWindows = processPendingFusion(sessionId);
    res.json({
      session_id: sessionId,
      windows_created: fusedWindows.length,
    });
  } catch (err) {
    console.error("[sensor-fusion] Failed to process fusion:", err);
    res.status(500).json({ error: "Failed to process fusion" });
  }
});

// ── Export Routes ───────────────────────────────────────────────────

/**
 * GET /api/export/:id - Export session as JSONL
 */
sensorFusionRouter.get("/export/:id", (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;

    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const jsonl = exportSessionAsJSONL(sessionId);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="session-${sessionId}.jsonl"`
    );
    res.send(jsonl);
  } catch (err) {
    console.error("[sensor-fusion] Failed to export session:", err);
    res.status(500).json({ error: "Failed to export session" });
  }
});

/**
 * GET /api/health - Health check
 */
sensorFusionRouter.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: Date.now() });
});
