/**
 * Intervention Logger
 *
 * Logs interventions and ratings to a JSONL file for analysis.
 * Each line is a complete JSON object for easy parsing.
 */

import { appendFile, readFile, access, writeFile } from "fs/promises";
import { constants } from "fs";
import type { Intervention, GapEvent } from "./types";
import type { LowEnergyState } from "./detectors";

// ── Log Entry Types ─────────────────────────────────────────────────

export interface InterventionLogEntry {
  timestamp: number;
  date: string; // ISO date for easy filtering
  intervention: Intervention;
  condition: "sensor_triggered" | "fixed_time" | "control";
}

export interface DailySummary {
  date: string;
  interventionCount: number;
  avgWellTimed: number | null;
  avgHelpedRegulation: number | null;
  avgFeltIntrusive: number | null;
  wantAgainTomorrow: number; // count of "yes"
  condition: "sensor_triggered" | "fixed_time";
}

export interface DecisionSnapshotLogEntry {
  timestamp: number;
  date: string;
  type: "decision_snapshot";
  message_id: string | null;
  decision_reason: string | null;
  feedback: unknown;
  context: unknown;
  decision: unknown;
  sent: boolean;
  sent_at: string | null;
  deferred_until: string | null;
}

type AnyLogEntry = Record<string, unknown>;

function extractDecisionReason(decision: unknown): string | null {
  if (decision === null || typeof decision !== "object") return null;
  const reason = (decision as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isInterventionLogEntry(value: unknown): value is InterventionLogEntry {
  if (!isObject(value)) return false;
  if (!("intervention" in value) || !isObject(value.intervention)) return false;
  return typeof value.intervention.id === "string";
}

function isDecisionSnapshotLogEntry(value: unknown): value is DecisionSnapshotLogEntry {
  if (!isObject(value)) return false;
  return value.type === "decision_snapshot";
}

// ── Logger Class ────────────────────────────────────────────────────

export class InterventionLogger {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  /**
   * Ensure log file exists
   */
  private async ensureFile(): Promise<void> {
    try {
      await access(this.logPath, constants.F_OK);
    } catch {
      await writeFile(this.logPath, "");
    }
  }

  /**
   * Log an intervention
   */
  async logIntervention(
    intervention: Intervention,
    condition: InterventionLogEntry["condition"] = "sensor_triggered"
  ): Promise<void> {
    await this.ensureFile();

    const entry: InterventionLogEntry = {
      timestamp: Date.now(),
      date: new Date().toISOString().split("T")[0],
      intervention,
      condition,
    };

    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.logPath, line);

    console.log(`[Logger] Intervention logged: ${intervention.type}`);
  }

  /**
   * Log one decision-cycle snapshot for offline debugging.
   */
  async logDecisionSnapshot(snapshot: {
    message_id?: string | null;
    decision_reason?: string | null;
    feedback?: unknown;
    context: unknown;
    decision: unknown;
    sent: boolean;
    sent_at?: string | null;
    deferred_until: string | null;
  }): Promise<void> {
    await this.ensureFile();

    const entry: DecisionSnapshotLogEntry = {
      timestamp: Date.now(),
      date: new Date().toISOString().split("T")[0],
      type: "decision_snapshot",
      message_id: snapshot.message_id ?? null,
      decision_reason: snapshot.decision_reason ?? extractDecisionReason(snapshot.decision),
      feedback: snapshot.feedback ?? null,
      context: snapshot.context,
      decision: snapshot.decision,
      sent: snapshot.sent,
      sent_at: snapshot.sent_at ?? null,
      deferred_until: snapshot.deferred_until,
    };

    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.logPath, line);
  }

  /**
   * Update an intervention with rating
   */
  async updateRating(
    interventionId: string,
    rating: Intervention["rating"]
  ): Promise<boolean> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      let updated = false;
      const newLines = lines.map((line) => {
        const entry = JSON.parse(line) as AnyLogEntry;
        if (isInterventionLogEntry(entry) && entry.intervention.id === interventionId) {
          entry.intervention.rating = rating;
          updated = true;
        }
        return JSON.stringify(entry);
      });

      if (updated) {
        await writeFile(this.logPath, newLines.join("\n") + "\n");
        console.log(`[Logger] Rating updated for ${interventionId}`);
      }

      return updated;
    } catch (error) {
      console.error("[Logger] Failed to update rating:", error);
      return false;
    }
  }

  /**
   * Update decision snapshot feedback (`good` | `bad` | null) by message_id.
   */
  async updateDecisionSnapshotFeedback(
    messageId: string,
    feedback: "good" | "bad" | null
  ): Promise<boolean> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      let updated = false;
      const newLines = lines.map((line) => {
        const entry = JSON.parse(line) as AnyLogEntry;
        if (
          isDecisionSnapshotLogEntry(entry) &&
          entry.message_id === messageId
        ) {
          entry.feedback = feedback;
          updated = true;
        }
        return JSON.stringify(entry);
      });

      if (updated) {
        await writeFile(this.logPath, newLines.join("\n") + "\n");
      }

      return updated;
    } catch (error) {
      console.error("[Logger] Failed to update decision snapshot feedback:", error);
      return false;
    }
  }

  /**
   * Get all entries for a specific date
   */
  async getEntriesForDate(date: string): Promise<InterventionLogEntry[]> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      return lines
        .map((line) => JSON.parse(line))
        .filter((entry): entry is InterventionLogEntry => isInterventionLogEntry(entry))
        .filter((entry) => entry.date === date);
    } catch {
      return [];
    }
  }

  /**
   * Get today's interventions
   */
  async getTodayInterventions(): Promise<Intervention[]> {
    const today = new Date().toISOString().split("T")[0];
    const entries = await this.getEntriesForDate(today);
    return entries
      .filter((e): e is InterventionLogEntry => "intervention" in e)
      .map((e) => e.intervention);
  }

  /**
   * Calculate daily summary for comparison
   */
  async getDailySummary(date: string): Promise<DailySummary | null> {
    const entries = await this.getEntriesForDate(date);

    if (entries.length === 0) {
      return null;
    }

    const rated = entries.filter((e) => e.intervention.rating);

    const avgField = (
      field: keyof NonNullable<Intervention["rating"]>
    ): number | null => {
      const values = rated
        .map((e) => e.intervention.rating?.[field])
        .filter((v): v is number | boolean => v !== undefined);

      if (values.length === 0) return null;

      // Handle boolean (wantAgainTomorrow)
      if (typeof values[0] === "boolean") {
        return values.filter((v) => v === true).length;
      }

      return (
        (values as number[]).reduce((a, b) => a + b, 0) / values.length
      );
    };

    return {
      date,
      interventionCount: entries.length,
      avgWellTimed: avgField("wellTimed"),
      avgHelpedRegulation: avgField("helpedRegulation"),
      avgFeltIntrusive: avgField("feltIntrusive"),
      wantAgainTomorrow: (avgField("wantAgainTomorrow") as number) || 0,
      condition: entries[0].condition === "fixed_time" ? "fixed_time" : "sensor_triggered",
    };
  }

  /**
   * Compare sensor-triggered vs fixed-time days
   */
  async compareConditions(): Promise<{
    sensorTriggered: DailySummary[];
    fixedTime: DailySummary[];
    analysis: {
      wellTimedDiff: number | null;
      recommendation: string;
    };
  }> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries = lines
        .map((line) => JSON.parse(line))
        .filter((entry): entry is InterventionLogEntry => isInterventionLogEntry(entry));

      // Group by date
      const byDate = new Map<string, InterventionLogEntry[]>();
      for (const entry of entries) {
        const existing = byDate.get(entry.date) || [];
        existing.push(entry);
        byDate.set(entry.date, existing);
      }

      // Calculate summaries
      const summaries: DailySummary[] = [];
      for (const [date, dateEntries] of byDate) {
        const summary = await this.getDailySummary(date);
        if (summary) {
          summaries.push(summary);
        }
      }

      const sensorTriggered = summaries.filter(
        (s) => s.condition === "sensor_triggered"
      );
      const fixedTime = summaries.filter((s) => s.condition === "fixed_time");

      // Calculate difference
      const avgSensorWellTimed =
        sensorTriggered.length > 0
          ? sensorTriggered
              .filter((s) => s.avgWellTimed !== null)
              .reduce((sum, s) => sum + (s.avgWellTimed || 0), 0) /
            sensorTriggered.filter((s) => s.avgWellTimed !== null).length
          : null;

      const avgFixedWellTimed =
        fixedTime.length > 0
          ? fixedTime
              .filter((s) => s.avgWellTimed !== null)
              .reduce((sum, s) => sum + (s.avgWellTimed || 0), 0) /
            fixedTime.filter((s) => s.avgWellTimed !== null).length
          : null;

      const wellTimedDiff =
        avgSensorWellTimed !== null && avgFixedWellTimed !== null
          ? avgSensorWellTimed - avgFixedWellTimed
          : null;

      let recommendation = "Insufficient data for comparison";
      if (wellTimedDiff !== null) {
        if (wellTimedDiff >= 1) {
          recommendation = `Sensor-triggered interventions score ${wellTimedDiff.toFixed(1)} points higher on "well-timed". Hypothesis supported.`;
        } else if (wellTimedDiff > 0) {
          recommendation = `Sensor-triggered slightly better (+${wellTimedDiff.toFixed(1)}), but difference is small.`;
        } else {
          recommendation = `Fixed-time interventions scored higher. Consider adjusting thresholds.`;
        }
      }

      return {
        sensorTriggered,
        fixedTime,
        analysis: {
          wellTimedDiff,
          recommendation,
        },
      };
    } catch {
      return {
        sensorTriggered: [],
        fixedTime: [],
        analysis: {
          wellTimedDiff: null,
          recommendation: "No data available",
        },
      };
    }
  }
}

/**
 * Format a summary for display
 */
export function formatSummary(summary: DailySummary): string {
  const lines = [
    `Date: ${summary.date}`,
    `Condition: ${summary.condition}`,
    `Interventions: ${summary.interventionCount}`,
  ];

  if (summary.avgWellTimed !== null) {
    lines.push(`Well-timed: ${summary.avgWellTimed.toFixed(1)}/5`);
  }
  if (summary.avgHelpedRegulation !== null) {
    lines.push(`Helped regulation: ${summary.avgHelpedRegulation.toFixed(1)}/5`);
  }
  if (summary.avgFeltIntrusive !== null) {
    lines.push(`Felt intrusive: ${summary.avgFeltIntrusive.toFixed(1)}/5`);
  }
  lines.push(`Want again: ${summary.wantAgainTomorrow} yes`);

  return lines.join("\n");
}

// ── Gap Event Logger ─────────────────────────────────────────────────

/**
 * Log a disconnect/reconnect gap event to the intervention JSONL log.
 * Non-critical: errors are logged to stderr but don't throw.
 */
export function logGapEvent(event: GapEvent, logPath: string): void {
  try {
    const entry = {
      timestamp: Date.now(),
      date: new Date().toISOString().split("T")[0],
      type: "gap" as const,
      disconnectedAt: event.disconnectedAt,
      reconnectedAt: event.reconnectedAt,
      gapDurationMs: event.gapDurationMs,
      batchesDuringWarmup: event.batchesDuringWarmup,
    };
    const line = JSON.stringify(entry) + "\n";
    require("fs").appendFileSync(logPath, line);
  } catch (err) {
    console.error("[Logger] Failed to log gap event:", err);
  }
}

// ── Energy State Logger ──────────────────────────────────────────────

export interface EnergyLogEntry {
  timestamp: number;
  date: string;
  time: string; // HH:MM local time
  state: LowEnergyState;
}

/**
 * Logger for energy state observations
 * Logs to a separate file for pattern analysis
 */
export class EnergyLogger {
  private logPath: string;
  private lastLogTime: number = 0;
  private minIntervalMs: number; // Don't log more often than this

  constructor(logPath: string, minIntervalMinutes: number = 5) {
    this.logPath = logPath;
    this.minIntervalMs = minIntervalMinutes * 60 * 1000;
  }

  private async ensureFile(): Promise<void> {
    try {
      await access(this.logPath, constants.F_OK);
    } catch {
      await writeFile(this.logPath, "");
    }
  }

  /**
   * Log energy state (throttled to avoid spam)
   */
  async logState(state: LowEnergyState): Promise<boolean> {
    const now = Date.now();

    // Throttle logging
    if (now - this.lastLogTime < this.minIntervalMs) {
      return false;
    }

    // Only log low energy states (medium or high confidence)
    if (!state.isLowEnergy || state.confidence === "low") {
      return false;
    }

    await this.ensureFile();

    const date = new Date();
    const entry: EnergyLogEntry = {
      timestamp: now,
      date: date.toISOString().split("T")[0],
      time: `${String(state.metrics.localHour).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
      state,
    };

    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.logPath, line);

    this.lastLogTime = now;
    console.log(`[Energy] Low energy logged: ${state.reasons.join(", ")}`);

    return true;
  }

  /**
   * Get energy entries for a date range
   */
  async getEntries(startDate?: string, endDate?: string): Promise<EnergyLogEntry[]> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      let entries = lines.map((line) => JSON.parse(line) as EnergyLogEntry);

      if (startDate) {
        entries = entries.filter((e) => e.date >= startDate);
      }
      if (endDate) {
        entries = entries.filter((e) => e.date <= endDate);
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Get daily summary of low energy periods
   */
  async getDailySummary(date: string): Promise<{
    date: string;
    lowEnergyPeriods: number;
    peakHours: number[];
    avgHR: number | null;
    avgHRV: number | null;
  } | null> {
    const entries = await this.getEntries(date, date);

    if (entries.length === 0) {
      return null;
    }

    const hours = entries.map((e) => e.state.metrics.localHour);
    const hrValues = entries
      .map((e) => e.state.metrics.hr)
      .filter((v): v is number => v !== null);
    const hrvValues = entries
      .map((e) => e.state.metrics.hrv)
      .filter((v): v is number => v !== null);

    // Find most common hours
    const hourCounts = new Map<number, number>();
    for (const h of hours) {
      hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
    }
    const peakHours = [...hourCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => hour);

    return {
      date,
      lowEnergyPeriods: entries.length,
      peakHours,
      avgHR: hrValues.length > 0
        ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length
        : null,
      avgHRV: hrvValues.length > 0
        ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length
        : null,
    };
  }
}
