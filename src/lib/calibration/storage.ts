/**
 * Calibration Storage
 *
 * localStorage management for calibration data.
 * Includes version checking for future migrations.
 */

import type { CalibrationData } from "./types";

const CALIBRATION_STORAGE_KEY = "flow-detector-calibration";
const CALIBRATION_VERSION = 2;

/**
 * Save calibration data to localStorage
 */
export function saveCalibration(data: CalibrationData): boolean {
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
    console.log("[Calibration] Saved to localStorage", {
      blinkThreshold: data.ear.blinkThreshold.toFixed(3),
      gazeCenter: `(${data.gaze.center.x.toFixed(3)}, ${data.gaze.center.y.toFixed(3)})`,
    });
    return true;
  } catch (error) {
    console.error("[Calibration] Failed to save:", error);
    return false;
  }
}

/**
 * Load calibration data from localStorage
 *
 * Returns null if no calibration exists or if version mismatch
 */
export function loadCalibration(): CalibrationData | null {
  try {
    const stored = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const data = JSON.parse(stored) as CalibrationData;

    // Version check for future migrations
    if (data.version !== CALIBRATION_VERSION) {
      console.warn(
        "[Calibration] Version mismatch:",
        data.version,
        "!=",
        CALIBRATION_VERSION
      );
      clearCalibration();
      return null;
    }

    // Validate required fields exist
    if (!data.ear || !data.gaze || !data.blinkTiming || !data.workingBaseline) {
      console.warn("[Calibration] Invalid data structure, clearing");
      clearCalibration();
      return null;
    }

    console.log("[Calibration] Loaded from localStorage", {
      calibratedAt: new Date(data.calibratedAt).toLocaleString(),
      blinkThreshold: data.ear.blinkThreshold.toFixed(3),
    });

    return data;
  } catch (error) {
    console.error("[Calibration] Failed to load:", error);
    return null;
  }
}

/**
 * Clear calibration data from localStorage
 */
export function clearCalibration(): void {
  localStorage.removeItem(CALIBRATION_STORAGE_KEY);
  console.log("[Calibration] Cleared from localStorage");
}

/**
 * Check if valid calibration exists
 */
export function hasValidCalibration(): boolean {
  return loadCalibration() !== null;
}

/**
 * Get calibration age in milliseconds
 *
 * Returns null if no calibration exists
 */
export function getCalibrationAge(): number | null {
  const data = loadCalibration();
  if (!data) return null;
  return Date.now() - data.calibratedAt;
}

/**
 * Format calibration date for display
 */
export function formatCalibrationDate(data: CalibrationData): string {
  const date = new Date(data.calibratedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
