/**
 * Intervention Logger
 *
 * Logs interventions and ratings to a JSONL file for analysis.
 * Each line is a complete JSON object for easy parsing.
 */

import { appendFile, readFile, access, writeFile } from "fs/promises";
import { constants } from "fs";
import type { Intervention } from "./types";

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
        const entry: InterventionLogEntry = JSON.parse(line);
        if (entry.intervention.id === interventionId) {
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
   * Get all entries for a specific date
   */
  async getEntriesForDate(date: string): Promise<InterventionLogEntry[]> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      return lines
        .map((line) => JSON.parse(line) as InterventionLogEntry)
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
    return entries.map((e) => e.intervention);
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
      const entries = lines.map((line) => JSON.parse(line) as InterventionLogEntry);

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
