/**
 * Sensor Fusion Database Types
 *
 * TypeScript interfaces for the SQLite database schema.
 * Stores correlated eye tracking + HR/HRV/EDA data.
 */

// ── Session ─────────────────────────────────────────────────────────

export interface Session {
  id: string;
  created_at: number;
  device_name: string | null;
  calibration_version: number | null;
}

export interface SessionInsert {
  id?: string; // Auto-generated UUID if not provided
  device_name?: string | null;
  calibration_version?: number | null;
}

// ── Eye Metrics (5s windows from browser) ───────────────────────────

export interface EyeMetricsRow {
  id: number;
  session_id: string;
  window_start: number;
  window_end: number;
  blink_rate: number;
  gaze_stability: number;
  average_ear: number;
  eye_flow_indicator: number;
  frame_count: number;
  quality: number; // 0-1, based on frame_count vs expected
  created_at: number;
}

export interface EyeMetricsInsert {
  session_id: string;
  window_start: number;
  window_end: number;
  blink_rate: number;
  gaze_stability: number;
  average_ear: number;
  eye_flow_indicator: number;
  frame_count: number;
  quality?: number;
}

// ── Watch Batches (30s windows from watch) ──────────────────────────

export interface WatchBatchRow {
  id: number;
  session_id: string;
  window_start: number;
  window_end: number;
  hr_mean: number | null;
  hr_min: number | null;
  hr_max: number | null;
  hr_samples: number;
  hrv_rmssd: number | null;
  hrv_sdnn: number | null;
  hrv_samples: number;
  eda_mean_scl: number | null;
  eda_min_scl: number | null;
  eda_max_scl: number | null;
  eda_samples: number;
  // PPG (photoplethysmography) raw sensor data
  ppg_green_mean: number | null;
  ppg_green_std: number | null;
  ppg_ir_mean: number | null;
  ppg_ir_std: number | null;
  ppg_red_mean: number | null;
  ppg_red_std: number | null;
  ppg_samples: number;
  // Accelerometer data for stillness detection
  accel_magnitude_mean: number | null;
  accel_magnitude_std: number | null;
  accel_stillness: number | null; // 0-1, higher = more still
  accel_samples: number;
  // Location (from watch GPS, if available)
  location_lat: number | null;
  location_lon: number | null;
  location_accuracy: number | null;
  quality: number; // 0-1, based on sample counts
  created_at: number;
}

export interface WatchBatchInsert {
  session_id: string;
  window_start: number;
  window_end: number;
  hr_mean?: number | null;
  hr_min?: number | null;
  hr_max?: number | null;
  hr_samples?: number;
  hrv_rmssd?: number | null;
  hrv_sdnn?: number | null;
  hrv_samples?: number;
  eda_mean_scl?: number | null;
  eda_min_scl?: number | null;
  eda_max_scl?: number | null;
  eda_samples?: number;
  // PPG fields (optional)
  ppg_green_mean?: number | null;
  ppg_green_std?: number | null;
  ppg_ir_mean?: number | null;
  ppg_ir_std?: number | null;
  ppg_red_mean?: number | null;
  ppg_red_std?: number | null;
  ppg_samples?: number;
  // Accelerometer fields (optional)
  accel_magnitude_mean?: number | null;
  accel_magnitude_std?: number | null;
  accel_stillness?: number | null;
  accel_samples?: number;
  // Location fields (optional)
  location_lat?: number | null;
  location_lon?: number | null;
  location_accuracy?: number | null;
  quality?: number;
}

// ── Events (markers, flow transitions, interventions) ───────────────

export type EventType = "marker" | "flow_start" | "flow_end" | "intervention";

export interface EventRow {
  id: number;
  session_id: string;
  timestamp: number;
  event_type: EventType;
  label: string | null;
  metadata: string | null; // JSON string
  created_at: number;
}

export interface EventInsert {
  session_id: string;
  timestamp: number;
  event_type: EventType;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ── Fused Windows (30s aligned sensor fusion) ───────────────────────

export interface FusedWindowRow {
  id: number;
  session_id: string;
  window_start: number;
  window_end: number;
  // Eye metrics (aggregated from 6x 5s windows)
  eye_blink_rate: number | null;
  eye_gaze_stability: number | null;
  eye_average_ear: number | null;
  eye_flow_indicator: number | null;
  eye_window_count: number; // How many 5s windows were aggregated
  eye_quality: number; // 0-1
  // Watch metrics (from single 30s batch)
  watch_hr_mean: number | null;
  watch_hr_min: number | null;
  watch_hr_max: number | null;
  watch_hrv_rmssd: number | null;
  watch_hrv_sdnn: number | null;
  watch_eda_mean_scl: number | null;
  watch_accel_stillness: number | null; // 0-1, higher = more still
  watch_quality: number; // 0-1
  // Combined
  combined_flow_score: number | null;
  motion_quality: number | null; // 0.5-1.0 multiplier based on stillness
  tier: string; // "eye-only", "eye+hrv", "eye+hrv+eda", "eye+hrv+eda+stillness"
  created_at: number;
}

export interface FusedWindowInsert {
  session_id: string;
  window_start: number;
  window_end: number;
  eye_blink_rate?: number | null;
  eye_gaze_stability?: number | null;
  eye_average_ear?: number | null;
  eye_flow_indicator?: number | null;
  eye_window_count?: number;
  eye_quality?: number;
  watch_hr_mean?: number | null;
  watch_hr_min?: number | null;
  watch_hr_max?: number | null;
  watch_hrv_rmssd?: number | null;
  watch_hrv_sdnn?: number | null;
  watch_eda_mean_scl?: number | null;
  watch_accel_stillness?: number | null;
  watch_quality?: number;
  combined_flow_score?: number | null;
  motion_quality?: number | null;
  tier?: string;
}

// ── Calendar Events (persisted from Google Calendar) ────────────────

export interface CalendarEventRow {
  id: number;
  session_id: string;
  event_uid: string;       // Google Calendar event ID
  summary: string;
  start_ts: number;        // Unix ms (epoch)
  end_ts: number;          // Unix ms (epoch)
  status: string;          // "confirmed" | "tentative" | "cancelled"
  event_type: string | null; // "default" | "focusTime" | "outOfOffice" | "workingLocation"
  is_all_day: number;      // 0 or 1
  raw_json: string | null; // Original event JSON for replay
  fetched_at: number;      // Unix ms when we fetched this
}

export interface CalendarEventInsert {
  session_id: string;
  event_uid: string;
  summary: string;
  start_ts: number;
  end_ts: number;
  status: string;
  event_type?: string | null;
  is_all_day?: number;
  raw_json?: string | null;
}

// ── API Request/Response Types ──────────────────────────────────────

export interface CreateSessionRequest {
  device_name?: string;
  calibration_version?: number;
}

export interface CreateSessionResponse {
  session_id: string;
  created_at: number;
}

export interface EyeMetricsRequest {
  session_id: string;
  window_start: number;
  window_end: number;
  blink_rate: number;
  gaze_stability: number;
  average_ear: number;
  eye_flow_indicator: number;
  frame_count: number;
}

export interface TimeAlignedQuery {
  session_id: string;
  start_time?: number;
  end_time?: number;
  limit?: number;
  offset?: number;
}

export interface ExportFormat {
  type: "jsonl" | "csv";
}
