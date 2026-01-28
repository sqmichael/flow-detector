/**
 * Watch Relay Server
 *
 * Standalone WebSocket server that relays messages from a Galaxy Watch app
 * to browser clients (Next.js app). The watch connects to /watch and the
 * browser connects to /browser.
 *
 * Run: npx tsx server/watch-relay.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage } from "http";
import { URL } from "url";
import { networkInterfaces } from "os";

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

// Connection tracking
const browserClients = new Set<WebSocket>();
let watchClient: WebSocket | null = null;
let watchDeviceName: string | null = null;

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

// Create HTTP server for path-based routing
const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(
    `Watch Relay Server\n` +
      `Watch: ${watchClient ? "connected" : "disconnected"}${watchDeviceName ? ` (${watchDeviceName})` : ""}\n` +
      `Browsers: ${browserClients.size} connected\n`
  );
});

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
  // Only allow one watch connection at a time
  if (watchClient && watchClient.readyState === WebSocket.OPEN) {
    log("Rejecting second watch connection — one already active");
    ws.close(4001, "Another watch is already connected.");
    return;
  }

  watchClient = ws;
  watchDeviceName = null;
  log("Watch connected");

  ws.on("message", (raw: Buffer) => {
    const data = raw.toString();

    // Try to parse for handshake/logging, but always relay
    try {
      const msg = JSON.parse(data);

      if (msg.type === "handshake") {
        watchDeviceName = msg.deviceName || "Unknown Watch";
        log(
          `Watch identified: ${watchDeviceName} (protocol v${msg.protocolVersion || "?"}), sensors: ${(msg.sensors || []).join(", ")}`
        );
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
    watchClient = null;
    watchDeviceName = null;
    sendWatchStatus(false);
  });

  ws.on("error", (err: Error) => {
    log(`Watch connection error: ${err.message}`);
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
  log(`Listening on ws://0.0.0.0:${PORT}`);
  log(`  Watch:   ws://${localIp}:${PORT}/watch`);
  log(`  Browser: ws://localhost:${PORT}/browser`);
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
  wss.close();
  httpServer.close();
  process.exit(0);
});
