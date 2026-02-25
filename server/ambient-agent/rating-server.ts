/**
 * Rating Server
 *
 * Simple HTTP server that receives ratings from ntfy action buttons.
 * Runs on port 8767.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { InterventionLogger } from "./logger";
import { DEFAULT_CONFIG } from "./types";

const PORT = 8767;

function log(...args: unknown[]) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [Rating]`, ...args);
}

let ratingLogger: InterventionLogger | null = null;

function getLogger(logPath?: string): InterventionLogger {
  if (!ratingLogger) {
    ratingLogger = new InterventionLogger(logPath || DEFAULT_CONFIG.logPath);
  }
  return ratingLogger;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Enable CORS for ntfy
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse URL: /rate/:id/:rating
  const match = req.url?.match(/^\/rate\/([^/]+)\/(good|ok|bad)$/);

  if (!match) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const [, id, rating] = match;

  // Map rating to numeric scores
  const ratingMap: Record<string, { wellTimed: number; helpedRegulation: number; feltIntrusive: number }> = {
    good: { wellTimed: 5, helpedRegulation: 4, feltIntrusive: 1 },
    ok: { wellTimed: 3, helpedRegulation: 3, feltIntrusive: 3 },
    bad: { wellTimed: 1, helpedRegulation: 1, feltIntrusive: 5 },
  };

  const scores = ratingMap[rating];

  try {
    const logger = getLogger();
    const ratingUpdated = await logger.updateRating(id, {
      ...scores,
      wantAgainTomorrow: rating === "good",
    });
    const feedback = rating === "good" ? "good" : rating === "bad" ? "bad" : null;
    const snapshotUpdated = await logger.updateDecisionSnapshotFeedback(id, feedback);
    const success = ratingUpdated || snapshotUpdated;

    if (success) {
      log(`Rated ${id}: ${rating}`);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`Thanks! Rated: ${rating}`);
    } else {
      log(`Failed to rate ${id}: not found`);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Intervention not found");
    }
  } catch (error) {
    log(`Error rating ${id}:`, error);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Error saving rating");
  }
});

export function startRatingServer(logPath?: string): void {
  if (logPath) {
    ratingLogger = new InterventionLogger(logPath);
  }
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${PORT} already in use - rating server skipped (another instance running)`);
    } else {
      log(`Server error: ${err.message}`);
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    log(`Listening on http://0.0.0.0:${PORT}`);
    log(`Rate endpoints: /rate/:id/good, /rate/:id/ok, /rate/:id/bad`);
  });
}

// Allow running standalone
if (require.main === module) {
  startRatingServer();
}
