/**
 * Biometrics Type Definitions
 *
 * Types for heart rate, HRV, and combined flow metrics
 * from Samsung Galaxy Watch via SensorServer.
 */

import type { AggregatedEyeMetrics } from "../mediapipe/types";

/**
 * Heart rate data from the watch
 */
export interface HeartRateData {
  /** Beats per minute */
  bpm: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Inter-Beat Interval data for HRV calculation
 */
export interface IBIData {
  /** Inter-beat interval in milliseconds */
  ibi: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Calculated HRV metrics
 */
export interface HRVMetrics {
  /** Root Mean Square of Successive Differences (ms) */
  rmssd: number;
  /** Standard Deviation of NN intervals (ms) */
  sdnn: number;
  /** Number of IBI samples used in calculation */
  sampleCount: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Raw message format from SensorServer app
 *
 * SensorServer sends JSON messages with sensor data.
 * For heart rate, values[0] is BPM.
 * For PPG/IBI data, values may contain timing info.
 */
export interface SensorServerMessage {
  /** Message type (e.g., "sensor_data") */
  type: string;
  /** Sensor name (e.g., "heart_rate", "ppg", "accelerometer") */
  sensor: string;
  /** Sensor values array */
  values: number[];
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Combined flow metrics merging eye tracking and HRV data
 */
export interface CombinedFlowMetrics {
  // Eye tracking metrics
  /** Blinks per minute */
  blinkRate: number;
  /** Gaze stability score (0-1) */
  gazeStability: number;
  /** Average Eye Aspect Ratio */
  averageEAR: number;
  /** Eye-only flow indicator (0-1) */
  eyeFlowIndicator: number;

  // HRV metrics (null if watch not connected)
  /** Heart rate in BPM */
  heartRate: number | null;
  /** RMSSD in milliseconds */
  rmssd: number | null;
  /** SDNN in milliseconds */
  sdnn: number | null;

  // Combined metrics
  /** Combined flow score (0-1) incorporating all sensors */
  combinedFlowScore: number;
  /** Whether watch data is included in the score */
  hasWatchData: boolean;

  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * SensorServer connection state
 */
export interface SensorServerState {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Connection error message if any */
  error: string | null;
  /** Current heart rate in BPM */
  heartRate: number | null;
  /** Current HRV metrics */
  hrv: HRVMetrics | null;
  /** Last received timestamp */
  lastUpdate: number | null;
}

/**
 * Configuration for HRV calculations
 */
export interface HRVConfig {
  /** Size of the sliding window in milliseconds (default: 60000 = 60s) */
  windowSizeMs: number;
  /** Minimum number of IBI samples needed for valid HRV (default: 10) */
  minSamples: number;
  /** Maximum IBI value to accept in ms (filter artifacts, default: 2000) */
  maxIBI: number;
  /** Minimum IBI value to accept in ms (filter artifacts, default: 300) */
  minIBI: number;
}

/**
 * Default HRV configuration
 */
export const DEFAULT_HRV_CONFIG: HRVConfig = {
  windowSizeMs: 60000, // 60 second window
  minSamples: 10,
  maxIBI: 2000, // Max 2 seconds between beats (30 BPM)
  minIBI: 300, // Min 300ms between beats (200 BPM)
};
