/**
 * Sensor Fusion Database
 *
 * SQLite wrapper using better-sqlite3 for storing correlated
 * eye tracking + HR/HRV/EDA sensor data.
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import type {
  Session,
  SessionInsert,
  EyeMetricsRow,
  EyeMetricsInsert,
  WatchBatchRow,
  WatchBatchInsert,
  EventRow,
  EventInsert,
  FusedWindowRow,
  FusedWindowInsert,
  CalendarEventRow,
  CalendarEventInsert,
} from "./types";

const DB_PATH = path.join(__dirname, "..", "data", "sensor-fusion.db");

let db: Database.Database | null = null;

/**
 * Initialize the database connection and create tables if needed
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  createTables(db);
  runMigrations(db);
  return db;
}

/**
 * Get the database instance (must call initDatabase first)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Check if a column exists in a table
 */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((c) => c.name === column);
}

/**
 * Run migrations to add new columns to existing tables
 */
function runMigrations(db: Database.Database): void {
  if (!columnExists(db, "eye_metrics", "activity_tag")) {
    db.exec(`ALTER TABLE eye_metrics ADD COLUMN activity_tag TEXT;`);
    console.log("[DB] Migration: Added activity_tag to eye_metrics");
  }

  // Migration: Add PPG columns to watch_batches
  if (!columnExists(db, "watch_batches", "ppg_green_mean")) {
    db.exec(`
      ALTER TABLE watch_batches ADD COLUMN ppg_green_mean REAL;
      ALTER TABLE watch_batches ADD COLUMN ppg_green_std REAL;
      ALTER TABLE watch_batches ADD COLUMN ppg_ir_mean REAL;
      ALTER TABLE watch_batches ADD COLUMN ppg_ir_std REAL;
      ALTER TABLE watch_batches ADD COLUMN ppg_red_mean REAL;
      ALTER TABLE watch_batches ADD COLUMN ppg_red_std REAL;
      ALTER TABLE watch_batches ADD COLUMN ppg_samples INTEGER NOT NULL DEFAULT 0;
    `);
    console.log("[DB] Migration: Added PPG columns to watch_batches");
  }

  // Migration: Add Accelerometer columns to watch_batches
  if (!columnExists(db, "watch_batches", "accel_magnitude_mean")) {
    db.exec(`
      ALTER TABLE watch_batches ADD COLUMN accel_magnitude_mean REAL;
      ALTER TABLE watch_batches ADD COLUMN accel_magnitude_std REAL;
      ALTER TABLE watch_batches ADD COLUMN accel_stillness REAL;
      ALTER TABLE watch_batches ADD COLUMN accel_samples INTEGER NOT NULL DEFAULT 0;
    `);
    console.log("[DB] Migration: Added accelerometer columns to watch_batches");
  }

  // Migration: Add location columns to watch_batches
  if (!columnExists(db, "watch_batches", "location_lat")) {
    db.exec(`
      ALTER TABLE watch_batches ADD COLUMN location_lat REAL;
      ALTER TABLE watch_batches ADD COLUMN location_lon REAL;
      ALTER TABLE watch_batches ADD COLUMN location_accuracy REAL;
    `);
    console.log("[DB] Migration: Added location columns to watch_batches");
  }

  if (!columnExists(db, "watch_batches", "activity_tag")) {
    db.exec(`ALTER TABLE watch_batches ADD COLUMN activity_tag TEXT;`);
    console.log("[DB] Migration: Added activity_tag to watch_batches");
  }

  // Migration: Add stillness/motion columns to fused_windows
  if (!columnExists(db, "fused_windows", "watch_accel_stillness")) {
    db.exec(`
      ALTER TABLE fused_windows ADD COLUMN watch_accel_stillness REAL;
      ALTER TABLE fused_windows ADD COLUMN motion_quality REAL;
    `);
    console.log("[DB] Migration: Added stillness columns to fused_windows");
  }

  if (!columnExists(db, "fused_windows", "activity_tag")) {
    db.exec(`ALTER TABLE fused_windows ADD COLUMN activity_tag TEXT;`);
    console.log("[DB] Migration: Added activity_tag to fused_windows");
  }
}

/**
 * Create all tables if they don't exist
 */
function createTables(db: Database.Database): void {
  db.exec(`
    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      device_name TEXT,
      calibration_version INTEGER
    );

    -- Eye metrics (5s windows from browser)
    CREATE TABLE IF NOT EXISTS eye_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      blink_rate REAL NOT NULL,
      gaze_stability REAL NOT NULL,
      average_ear REAL NOT NULL,
      eye_flow_indicator REAL NOT NULL,
      frame_count INTEGER NOT NULL,
      activity_tag TEXT,
      quality REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    -- Index for time-based queries
    CREATE INDEX IF NOT EXISTS idx_eye_metrics_session_time
      ON eye_metrics(session_id, window_start);

    -- Watch batches (30s windows from watch)
    CREATE TABLE IF NOT EXISTS watch_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      activity_tag TEXT,
      hr_mean REAL,
      hr_min REAL,
      hr_max REAL,
      hr_samples INTEGER NOT NULL DEFAULT 0,
      hrv_rmssd REAL,
      hrv_sdnn REAL,
      hrv_samples INTEGER NOT NULL DEFAULT 0,
      eda_mean_scl REAL,
      eda_min_scl REAL,
      eda_max_scl REAL,
      eda_samples INTEGER NOT NULL DEFAULT 0,
      quality REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_watch_batches_session_time
      ON watch_batches(session_id, window_start);

    -- Events (markers, flow transitions, interventions)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      label TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_session_time
      ON events(session_id, timestamp);

    -- Fused windows (30s aligned sensor fusion)
    CREATE TABLE IF NOT EXISTS fused_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      eye_blink_rate REAL,
      eye_gaze_stability REAL,
      eye_average_ear REAL,
      eye_flow_indicator REAL,
      activity_tag TEXT,
      eye_window_count INTEGER NOT NULL DEFAULT 0,
      eye_quality REAL NOT NULL DEFAULT 0.0,
      watch_hr_mean REAL,
      watch_hr_min REAL,
      watch_hr_max REAL,
      watch_hrv_rmssd REAL,
      watch_hrv_sdnn REAL,
      watch_eda_mean_scl REAL,
      watch_quality REAL NOT NULL DEFAULT 0.0,
      combined_flow_score REAL,
      tier TEXT NOT NULL DEFAULT 'eye-only',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_fused_windows_session_time
      ON fused_windows(session_id, window_start);

    -- Calendar events (persisted from Google Calendar)
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_uid TEXT NOT NULL,
      summary TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      event_type TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      fetched_at INTEGER NOT NULL,
      UNIQUE(session_id, event_uid, start_ts)
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_session_time
      ON calendar_events(session_id, start_ts, end_ts);
  `);
}

// ── Session Operations ──────────────────────────────────────────────

export function createSession(data: SessionInsert): Session {
  const db = getDatabase();
  const id = data.id || randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO sessions (id, created_at, device_name, calibration_version)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(id, now, data.device_name ?? null, data.calibration_version ?? null);

  return {
    id,
    created_at: now,
    device_name: data.device_name ?? null,
    calibration_version: data.calibration_version ?? null,
  };
}

export function getSession(id: string): Session | null {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  return stmt.get(id) as Session | null;
}

export function listSessions(limit = 50): Session[] {
  const db = getDatabase();
  const stmt = db.prepare(
    "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?"
  );
  return stmt.all(limit) as Session[];
}

// ── Eye Metrics Operations ──────────────────────────────────────────

export function insertEyeMetrics(data: EyeMetricsInsert): EyeMetricsRow {
  const db = getDatabase();
  const now = Date.now();

  // Calculate quality based on frame count (expect ~150 frames in 5s at 30fps)
  const expectedFrames = 150;
  const quality = data.quality ?? Math.min(1.0, data.frame_count / expectedFrames);

  const stmt = db.prepare(`
    INSERT INTO eye_metrics (
      session_id, window_start, window_end, blink_rate, gaze_stability,
      average_ear, eye_flow_indicator, frame_count, activity_tag, quality, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.session_id,
    data.window_start,
    data.window_end,
    data.blink_rate,
    data.gaze_stability,
    data.average_ear,
    data.eye_flow_indicator,
    data.frame_count,
    data.activity_tag ?? null,
    quality,
    now
  );

  return {
    id: Number(result.lastInsertRowid),
    session_id: data.session_id,
    window_start: data.window_start,
    window_end: data.window_end,
    blink_rate: data.blink_rate,
    gaze_stability: data.gaze_stability,
    average_ear: data.average_ear,
    eye_flow_indicator: data.eye_flow_indicator,
    frame_count: data.frame_count,
    activity_tag: data.activity_tag ?? null,
    quality,
    created_at: now,
  };
}

export function getEyeMetricsInRange(
  sessionId: string,
  startTime: number,
  endTime: number
): EyeMetricsRow[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM eye_metrics
    WHERE session_id = ? AND window_start >= ? AND window_end <= ?
    ORDER BY window_start
  `);
  return stmt.all(sessionId, startTime, endTime) as EyeMetricsRow[];
}

// ── Watch Batch Operations ──────────────────────────────────────────

export function insertWatchBatch(data: WatchBatchInsert): WatchBatchRow {
  const db = getDatabase();
  const now = Date.now();

  // Calculate quality based on sample counts
  const hrQuality = Math.min(1.0, (data.hr_samples || 0) / 30);
  const edaQuality = Math.min(1.0, (data.eda_samples || 0) / 30);
  const quality = data.quality ?? (hrQuality + edaQuality) / 2;

  const stmt = db.prepare(`
    INSERT INTO watch_batches (
      session_id, window_start, window_end, activity_tag, hr_mean, hr_min, hr_max, hr_samples,
      hrv_rmssd, hrv_sdnn, hrv_samples, eda_mean_scl, eda_min_scl, eda_max_scl,
      eda_samples, ppg_green_mean, ppg_green_std, ppg_ir_mean, ppg_ir_std,
      ppg_red_mean, ppg_red_std, ppg_samples, accel_magnitude_mean,
      accel_magnitude_std, accel_stillness, accel_samples,
      location_lat, location_lon, location_accuracy, quality, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.session_id,
    data.window_start,
    data.window_end,
    data.activity_tag ?? null,
    data.hr_mean ?? null,
    data.hr_min ?? null,
    data.hr_max ?? null,
    data.hr_samples ?? 0,
    data.hrv_rmssd ?? null,
    data.hrv_sdnn ?? null,
    data.hrv_samples ?? 0,
    data.eda_mean_scl ?? null,
    data.eda_min_scl ?? null,
    data.eda_max_scl ?? null,
    data.eda_samples ?? 0,
    data.ppg_green_mean ?? null,
    data.ppg_green_std ?? null,
    data.ppg_ir_mean ?? null,
    data.ppg_ir_std ?? null,
    data.ppg_red_mean ?? null,
    data.ppg_red_std ?? null,
    data.ppg_samples ?? 0,
    data.accel_magnitude_mean ?? null,
    data.accel_magnitude_std ?? null,
    data.accel_stillness ?? null,
    data.accel_samples ?? 0,
    data.location_lat ?? null,
    data.location_lon ?? null,
    data.location_accuracy ?? null,
    quality,
    now
  );

  return {
    id: Number(result.lastInsertRowid),
    session_id: data.session_id,
    window_start: data.window_start,
    window_end: data.window_end,
    activity_tag: data.activity_tag ?? null,
    hr_mean: data.hr_mean ?? null,
    hr_min: data.hr_min ?? null,
    hr_max: data.hr_max ?? null,
    hr_samples: data.hr_samples ?? 0,
    hrv_rmssd: data.hrv_rmssd ?? null,
    hrv_sdnn: data.hrv_sdnn ?? null,
    hrv_samples: data.hrv_samples ?? 0,
    eda_mean_scl: data.eda_mean_scl ?? null,
    eda_min_scl: data.eda_min_scl ?? null,
    eda_max_scl: data.eda_max_scl ?? null,
    eda_samples: data.eda_samples ?? 0,
    ppg_green_mean: data.ppg_green_mean ?? null,
    ppg_green_std: data.ppg_green_std ?? null,
    ppg_ir_mean: data.ppg_ir_mean ?? null,
    ppg_ir_std: data.ppg_ir_std ?? null,
    ppg_red_mean: data.ppg_red_mean ?? null,
    ppg_red_std: data.ppg_red_std ?? null,
    ppg_samples: data.ppg_samples ?? 0,
    accel_magnitude_mean: data.accel_magnitude_mean ?? null,
    accel_magnitude_std: data.accel_magnitude_std ?? null,
    accel_stillness: data.accel_stillness ?? null,
    accel_samples: data.accel_samples ?? 0,
    location_lat: data.location_lat ?? null,
    location_lon: data.location_lon ?? null,
    location_accuracy: data.location_accuracy ?? null,
    quality,
    created_at: now,
  };
}

export function getWatchBatchInRange(
  sessionId: string,
  startTime: number,
  endTime: number
): WatchBatchRow[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM watch_batches
    WHERE session_id = ? AND window_start >= ? AND window_end <= ?
    ORDER BY window_start
  `);
  return stmt.all(sessionId, startTime, endTime) as WatchBatchRow[];
}

// ── Event Operations ────────────────────────────────────────────────

export function insertEvent(data: EventInsert): EventRow {
  const db = getDatabase();
  const now = Date.now();
  const metadata = data.metadata ? JSON.stringify(data.metadata) : null;

  const stmt = db.prepare(`
    INSERT INTO events (session_id, timestamp, event_type, label, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.session_id,
    data.timestamp,
    data.event_type,
    data.label ?? null,
    metadata,
    now
  );

  return {
    id: Number(result.lastInsertRowid),
    session_id: data.session_id,
    timestamp: data.timestamp,
    event_type: data.event_type,
    label: data.label ?? null,
    metadata,
    created_at: now,
  };
}

export function getEventsInRange(
  sessionId: string,
  startTime: number,
  endTime: number
): EventRow[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp
  `);
  return stmt.all(sessionId, startTime, endTime) as EventRow[];
}

// ── Fused Window Operations ─────────────────────────────────────────

export function insertFusedWindow(data: FusedWindowInsert): FusedWindowRow {
  const db = getDatabase();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO fused_windows (
      session_id, window_start, window_end, eye_blink_rate, eye_gaze_stability,
      eye_average_ear, eye_flow_indicator, activity_tag, eye_window_count, eye_quality,
      watch_hr_mean, watch_hr_min, watch_hr_max, watch_hrv_rmssd, watch_hrv_sdnn,
      watch_eda_mean_scl, watch_accel_stillness, watch_quality, combined_flow_score,
      motion_quality, tier, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.session_id,
    data.window_start,
    data.window_end,
    data.eye_blink_rate ?? null,
    data.eye_gaze_stability ?? null,
    data.eye_average_ear ?? null,
    data.eye_flow_indicator ?? null,
    data.activity_tag ?? null,
    data.eye_window_count ?? 0,
    data.eye_quality ?? 0.0,
    data.watch_hr_mean ?? null,
    data.watch_hr_min ?? null,
    data.watch_hr_max ?? null,
    data.watch_hrv_rmssd ?? null,
    data.watch_hrv_sdnn ?? null,
    data.watch_eda_mean_scl ?? null,
    data.watch_accel_stillness ?? null,
    data.watch_quality ?? 0.0,
    data.combined_flow_score ?? null,
    data.motion_quality ?? null,
    data.tier ?? "eye-only",
    now
  );

  return {
    id: Number(result.lastInsertRowid),
    session_id: data.session_id,
    window_start: data.window_start,
    window_end: data.window_end,
    eye_blink_rate: data.eye_blink_rate ?? null,
    eye_gaze_stability: data.eye_gaze_stability ?? null,
    eye_average_ear: data.eye_average_ear ?? null,
    eye_flow_indicator: data.eye_flow_indicator ?? null,
    activity_tag: data.activity_tag ?? null,
    eye_window_count: data.eye_window_count ?? 0,
    eye_quality: data.eye_quality ?? 0.0,
    watch_hr_mean: data.watch_hr_mean ?? null,
    watch_hr_min: data.watch_hr_min ?? null,
    watch_hr_max: data.watch_hr_max ?? null,
    watch_hrv_rmssd: data.watch_hrv_rmssd ?? null,
    watch_hrv_sdnn: data.watch_hrv_sdnn ?? null,
    watch_eda_mean_scl: data.watch_eda_mean_scl ?? null,
    watch_accel_stillness: data.watch_accel_stillness ?? null,
    watch_quality: data.watch_quality ?? 0.0,
    combined_flow_score: data.combined_flow_score ?? null,
    motion_quality: data.motion_quality ?? null,
    tier: data.tier ?? "eye-only",
    created_at: now,
  };
}

export function getFusedWindowsInRange(
  sessionId: string,
  startTime?: number,
  endTime?: number,
  limit = 1000,
  offset = 0
): FusedWindowRow[] {
  const db = getDatabase();

  if (startTime !== undefined && endTime !== undefined) {
    const stmt = db.prepare(`
      SELECT * FROM fused_windows
      WHERE session_id = ? AND window_start >= ? AND window_end <= ?
      ORDER BY window_start
      LIMIT ? OFFSET ?
    `);
    return stmt.all(sessionId, startTime, endTime, limit, offset) as FusedWindowRow[];
  }

  const stmt = db.prepare(`
    SELECT * FROM fused_windows
    WHERE session_id = ?
    ORDER BY window_start
    LIMIT ? OFFSET ?
  `);
  return stmt.all(sessionId, limit, offset) as FusedWindowRow[];
}

// ── Calendar Event Operations ───────────────────────────────────────

/**
 * Upsert calendar events — insert or update on conflict.
 * Designed to be called after every fetchCalendarContext() cycle.
 */
export function upsertCalendarEvents(events: CalendarEventInsert[]): number {
  const db = getDatabase();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO calendar_events (
      session_id, event_uid, summary, start_ts, end_ts, status,
      event_type, is_all_day, raw_json, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, event_uid, start_ts) DO UPDATE SET
      summary = excluded.summary,
      end_ts = excluded.end_ts,
      status = excluded.status,
      event_type = excluded.event_type,
      raw_json = excluded.raw_json,
      fetched_at = excluded.fetched_at
  `);

  const upsertMany = db.transaction((rows: CalendarEventInsert[]) => {
    let count = 0;
    for (const e of rows) {
      stmt.run(
        e.session_id,
        e.event_uid,
        e.summary,
        e.start_ts,
        e.end_ts,
        e.status,
        e.event_type ?? null,
        e.is_all_day ?? 0,
        e.raw_json ?? null,
        now
      );
      count++;
    }
    return count;
  });

  return upsertMany(events);
}

/**
 * Get calendar events overlapping a time range.
 * Uses interval overlap: event.start < rangeEnd AND event.end > rangeStart
 */
export function getCalendarEventsInRange(
  sessionId: string,
  rangeStart: number,
  rangeEnd: number
): CalendarEventRow[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM calendar_events
    WHERE session_id = ?
      AND status != 'cancelled'
      AND start_ts < ?
      AND end_ts > ?
    ORDER BY start_ts
  `);
  return stmt.all(sessionId, rangeEnd, rangeStart) as CalendarEventRow[];
}

/**
 * Get all calendar events for a session, optionally filtered by time.
 */
export function getCalendarEvents(
  sessionId: string,
  limit = 100
): CalendarEventRow[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM calendar_events
    WHERE session_id = ?
      AND status != 'cancelled'
    ORDER BY start_ts DESC
    LIMIT ?
  `);
  return stmt.all(sessionId, limit) as CalendarEventRow[];
}

// ── Export Operations ───────────────────────────────────────────────

export function exportSessionAsJSONL(sessionId: string): string {
  const db = getDatabase();

  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const lines: string[] = [];

  // Export session metadata
  lines.push(JSON.stringify({ type: "session", ...session }));

  // Export eye metrics
  const eyeMetrics = db
    .prepare("SELECT * FROM eye_metrics WHERE session_id = ? ORDER BY window_start")
    .all(sessionId) as EyeMetricsRow[];
  for (const row of eyeMetrics) {
    lines.push(JSON.stringify({ type: "eye_metrics", ...row }));
  }

  // Export watch batches
  const watchBatches = db
    .prepare("SELECT * FROM watch_batches WHERE session_id = ? ORDER BY window_start")
    .all(sessionId) as WatchBatchRow[];
  for (const row of watchBatches) {
    lines.push(JSON.stringify({ type: "watch_batch", ...row }));
  }

  // Export events
  const events = db
    .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY timestamp")
    .all(sessionId) as EventRow[];
  for (const row of events) {
    lines.push(JSON.stringify({ type: "event", ...row }));
  }

  // Export fused windows
  const fusedWindows = db
    .prepare("SELECT * FROM fused_windows WHERE session_id = ? ORDER BY window_start")
    .all(sessionId) as FusedWindowRow[];
  for (const row of fusedWindows) {
    lines.push(JSON.stringify({ type: "fused_window", ...row }));
  }

  // Export calendar events
  const calendarEvents = db
    .prepare("SELECT * FROM calendar_events WHERE session_id = ? ORDER BY start_ts")
    .all(sessionId) as CalendarEventRow[];
  for (const row of calendarEvents) {
    lines.push(JSON.stringify({ type: "calendar_event", ...row }));
  }

  return lines.join("\n");
}
