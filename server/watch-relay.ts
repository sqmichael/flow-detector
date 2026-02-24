/**
 * Watch Relay Server
 *
 * Standalone WebSocket server that relays messages from a Galaxy Watch app
 * to browser clients (Next.js app). The watch connects to /watch and the
 * browser connects to /browser.
 *
 * Also serves HTTP API endpoints for sensor fusion database.
 *
 * Run: npx tsx server/watch-relay.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage } from "http";
import { URL } from "url";
import { networkInterfaces } from "os";
import express from "express";
import cors from "cors";
import {
  initDatabase,
  closeDatabase,
  insertWatchBatch,
  createSession,
} from "./sensor-fusion/database";
import { sensorFusionRouter } from "./sensor-fusion/routes";
import { processPendingFusion } from "./sensor-fusion/fusion";

const PORT = 8765;
const VERBOSE = process.argv.includes("--verbose");

function log(...args: unknown[]) {
  console.log(`[Watch Relay]`, ...args);
}

function logVerbose(...args: unknown[]) {
  if (VERBOSE) {
    console.log(`[Watch Relay]`, ...args);
  }
}

// Initialize database
log("Initializing sensor fusion database...");
initDatabase();
log("Database initialized");

// Connection tracking
const browserClients = new Set<WebSocket>();
let watchClient: WebSocket | null = null;
let watchDeviceName: string | null = null;
let watchPingInterval: NodeJS.Timeout | null = null;

const PING_INTERVAL_MS = 15000; // 15 seconds

// Extended WebSocket type with isAlive flag
interface WatchWebSocket extends WebSocket {
  isAlive?: boolean;
}

/**
 * Clean up watch connection state
 * IMPORTANT: Guarded by socket identity to prevent race conditions
 * where an old socket's close event kills a new connection
 */
function cleanupWatchConnection(reason: string, ws?: WebSocket) {
  // Only clean up if this is still the active watch (or no ws specified)
  if (ws && watchClient !== ws) {
    logVerbose(`Skip cleanup for stale ws: ${reason}`);
    return;
  }

  if (watchPingInterval) {
    clearInterval(watchPingInterval);
    watchPingInterval = null;
  }
  if (watchClient) {
    log(`Cleaning up watch connection: ${reason}`);
    if (
      watchClient.readyState === WebSocket.OPEN ||
      watchClient.readyState === WebSocket.CONNECTING
    ) {
      try {
        watchClient.terminate(); // Force close
      } catch {
        // Ignore errors during cleanup
      }
    }
    watchClient = null;
    watchDeviceName = null;
    sendWatchStatus(false);
    // Auto-created sessions are scoped to a single watch connection window.
    // Clearing on disconnect prevents unrelated reconnect periods from merging.
    if (activeSessionSource === "auto") {
      setActiveSession(null);
    }
  }
}

/**
 * Start ping/pong heartbeat for watch connection
 * Uses per-socket isAlive flag for proper liveness detection
 */
function startWatchHeartbeat(ws: WatchWebSocket) {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
    logVerbose("Watch pong received");
  });

  watchPingInterval = setInterval(() => {
    // Guard: only process if this is still the active watch
    if (watchClient !== ws) {
      logVerbose("Heartbeat for stale socket, stopping");
      return;
    }

    if (!ws.isAlive) {
      log("Watch heartbeat timeout - no pong received");
      cleanupWatchConnection("heartbeat timeout", ws);
      return;
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.isAlive = false;
      ws.ping();
      logVerbose("Watch ping sent");
    } else {
      log(`Watch in unexpected state: ${ws.readyState}`);
      cleanupWatchConnection("unexpected socket state", ws);
    }
  }, PING_INTERVAL_MS);
}

// Active session tracking (set by browser when creating session)
let activeSessionId: string | null = null;
let activeSessionSource: "manual" | "auto" | null = null;

/**
 * Set the active session ID for watch batch storage
 */
export function setActiveSession(
  sessionId: string | null,
  source: "manual" | "auto" = "manual"
): void {
  activeSessionId = sessionId;
  activeSessionSource = sessionId ? source : null;
  if (sessionId) {
    log(`Active session set: ${sessionId} (${source})`);
  } else {
    log("Active session cleared");
  }
}

/**
 * Ensure there is an active session before storing watch data.
 * If none is active, create an automatic session so streaming data
 * is never silently dropped when browser session activation is missing.
 */
function ensureActiveSessionForWatchBatch(): string {
  if (activeSessionId) return activeSessionId;

  const autoSession = createSession({
    device_name: watchDeviceName ?? "watch-auto",
  });
  setActiveSession(autoSession.id, "auto");
  log(`Auto-created session for watch ingestion: ${autoSession.id}`);
  return autoSession.id;
}

/**
 * Send a message to all connected browser clients
 */
function broadcastToBrowsers(data: string) {
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/**
 * Send watch_status message to all browser clients
 */
function sendWatchStatus(connected: boolean) {
  const status = JSON.stringify({
    type: "watch_status",
    connected,
    deviceName: watchDeviceName,
    timestamp: Date.now(),
  });
  broadcastToBrowsers(status);
}

/**
 * Store watch batch in database if session is active
 */
function storeWatchBatch(msg: {
  windowStart: number;
  windowEnd: number;
  windowMs?: number;
  timestamp?: number;
  hr?: { mean?: number; min?: number; max?: number; samples?: number };
  hrv?: { rmssd?: number; sdnn?: number; samples?: number };
  eda?: { meanScl?: number; minScl?: number; maxScl?: number; samples?: number };
  location?: { latitude: number; longitude: number; accuracy: number };
}): void {
  try {
    const sessionId = ensureActiveSessionForWatchBatch();
    const windowEnd = msg.windowEnd ?? msg.timestamp ?? Date.now();
    const resolvedWindowMs = msg.windowMs ?? 30_000;
    const windowStart = msg.windowStart ?? Math.max(0, windowEnd - resolvedWindowMs);
    insertWatchBatch({
      session_id: sessionId,
      window_start: windowStart,
      window_end: windowEnd,
      hr_mean: msg.hr?.mean ?? null,
      hr_min: msg.hr?.min ?? null,
      hr_max: msg.hr?.max ?? null,
      hr_samples: msg.hr?.samples ?? 0,
      hrv_rmssd: msg.hrv?.rmssd ?? null,
      hrv_sdnn: msg.hrv?.sdnn ?? null,
      hrv_samples: msg.hrv?.samples ?? 0,
      eda_mean_scl: msg.eda?.meanScl ?? null,
      eda_min_scl: msg.eda?.minScl ?? null,
      eda_max_scl: msg.eda?.maxScl ?? null,
      eda_samples: msg.eda?.samples ?? 0,
      location_lat: msg.location?.latitude ?? null,
      location_lon: msg.location?.longitude ?? null,
      location_accuracy: msg.location?.accuracy ?? null,
    });

    // Trigger fusion after storing watch batch
    const fusedWindows = processPendingFusion(sessionId);
    if (fusedWindows.length > 0) {
      logVerbose(`Created ${fusedWindows.length} fused window(s)`);
    }
    logVerbose(`Stored watch batch for session ${sessionId}`);
  } catch (err) {
    log(`Failed to store watch batch: ${err}`);
  }
}

// Create Express app for HTTP routes
const app = express();
app.use(cors());
app.use(express.json());

// Mount sensor fusion API routes
app.use("/api", sensorFusionRouter);

// Session activation endpoint
app.post("/api/session/activate", (req, res) => {
  const { session_id } = req.body;
  if (session_id) {
    setActiveSession(session_id);
    res.json({ activated: true, session_id });
  } else {
    setActiveSession(null);
    res.json({ activated: false });
  }
});

// Status endpoint
app.get("/", (_req, res) => {
  res.type("text/plain").send(
    `Watch Relay Server\n` +
      `Watch: ${watchClient ? "connected" : "disconnected"}${watchDeviceName ? ` (${watchDeviceName})` : ""}\n` +
      `Browsers: ${browserClients.size} connected\n` +
      `Active Session: ${activeSessionId || "none"}${activeSessionSource ? ` (${activeSessionSource})` : ""}\n` +
      `\nAPI Endpoints:\n` +
      `  POST /api/sessions - Create session\n` +
      `  GET  /api/sessions - List sessions\n` +
      `  POST /api/sensors/eye - Receive eye metrics\n` +
      `  GET  /api/fusion/time-aligned/:id - Query fused data\n` +
      `  GET  /api/export/:id - Export session as JSONL\n`
  );
});

// Create HTTP server using Express
const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/watch") {
    handleWatchConnection(ws);
  } else if (path === "/browser") {
    handleBrowserConnection(ws);
  } else {
    log(`Rejected connection to unknown path: ${path}`);
    ws.close(4000, "Unknown path. Use /watch or /browser.");
  }
});

function handleWatchConnection(ws: WebSocket) {
  // Check if there's an existing watch connection
  if (watchClient) {
    const isOpen = watchClient.readyState === WebSocket.OPEN;
    const isAlive = (watchClient as WatchWebSocket).isAlive === true;

    // Only reject if connection is open AND confirmed alive by heartbeat
    if (isOpen && isAlive) {
      log("Rejecting second watch connection — one already active");
      ws.close(4001, "Another watch is already connected.");
      return;
    }

    // Existing connection is stale (either closed or no recent pong)
    log("Existing watch connection is stale, replacing");
    cleanupWatchConnection("stale connection detected on new connect", watchClient);
  }

  watchClient = ws;
  watchDeviceName = null;
  log("Watch connected");

  // Start heartbeat monitoring
  startWatchHeartbeat(ws as WatchWebSocket);

  ws.on("message", (raw: Buffer) => {
    const data = raw.toString();

    // Try to parse for handshake/logging, but always relay
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);

      if (msg.type === "handshake") {
        watchDeviceName = (msg.deviceName as string) || "Unknown Watch";
        log(
          `Watch identified: ${watchDeviceName} (protocol v${msg.protocolVersion || "?"}), sensors: ${((msg.sensors as string[]) || []).join(", ")}`
        );
      } else if (msg.type === "batch") {
        const hr = msg.hr as Record<string, number> | null;
        const hrv = msg.hrv as Record<string, number> | null;
        const eda = msg.eda as Record<string, number> | null;
        const hrInfo = hr ? `HR=${hr.mean?.toFixed?.(0) || "?"} (${hr.samples || 0} samples)` : "HR=none";
        log(
          `Batch: ${hrInfo}, ` +
            `HRV=${hrv?.rmssd?.toFixed?.(1) || "?"}ms, SCL=${eda?.meanScl?.toFixed?.(2) || "?"}µS`
        );

        // Store watch batch in database
        storeWatchBatch(msg as Parameters<typeof storeWatchBatch>[0]);
      } else {
        logVerbose(`Watch → browsers: ${msg.type}`);
      }
    } catch {
      log(`Watch sent malformed JSON (${data.length} bytes), skipping relay`);
      return;
    }

    broadcastToBrowsers(data);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    log(
      `Watch disconnected: code=${code}, reason=${reason.toString() || "none"}`
    );
    cleanupWatchConnection("close event", ws);
  });

  ws.on("error", (err: Error) => {
    log(`Watch connection error: ${err.message}`);
    cleanupWatchConnection("error event", ws);
  });

  // Notify browsers that watch is connected
  // (device name will come with handshake)
  sendWatchStatus(true);
}

function handleBrowserConnection(ws: WebSocket) {
  browserClients.add(ws);
  log(`Browser connected (${browserClients.size} total)`);

  // Send current watch status immediately
  const status = JSON.stringify({
    type: "watch_status",
    connected: watchClient !== null && watchClient.readyState === WebSocket.OPEN,
    deviceName: watchDeviceName,
    timestamp: Date.now(),
  });
  ws.send(status);

  ws.on("close", (code: number, reason: Buffer) => {
    browserClients.delete(ws);
    log(
      `Browser disconnected (${browserClients.size} remaining): code=${code}, reason=${reason.toString() || "none"}`
    );
  });

  ws.on("error", (err: Error) => {
    log(`Browser connection error: ${err.message}`);
    browserClients.delete(ws);
  });
}

httpServer.listen(PORT, "0.0.0.0", () => {
  const localIp = getLocalIp();
  log(`Listening on http://0.0.0.0:${PORT}`);
  log(`  Watch:   ws://${localIp}:${PORT}/watch`);
  log(`  Browser: ws://localhost:${PORT}/browser`);
  log(`  API:     http://localhost:${PORT}/api`);
  log(`  Verbose: ${VERBOSE ? "ON" : "OFF (use --verbose)"}`);
});

function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// Graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down...");
  cleanupWatchConnection("server shutdown");
  closeDatabase();
  wss.close();
  httpServer.close();
  process.exit(0);
});
