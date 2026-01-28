/**
 * IndexedDB persistence for biometric session logging.
 *
 * Stores HR, EDA, flow score, marker, and annotation events
 * in two object stores: `sessions` (metadata) and `events` (data).
 * All operations are async and use raw IndexedDB (no dependencies).
 */

const DB_NAME = "flow-detector-log";
const DB_VERSION = 1;

// ── Event types ──────────────────────────────────────────────────────

export interface HREvent {
  type: "hr";
  sessionId: string;
  timestamp: number;
  bpm: number;
  ibi: number | null;
  rmssd: number | null;
  sdnn: number | null;
}

export interface EDAEvent {
  type: "eda";
  sessionId: string;
  timestamp: number;
  scl: number;
}

export interface FlowEvent {
  type: "flow";
  sessionId: string;
  timestamp: number;
  score: number;
  smoothedScore: number;
  tier: string;
  inFlow: boolean;
}

export interface MarkerEvent {
  type: "marker";
  sessionId: string;
  timestamp: number;
  tag?: string;
}

export interface AnnotationEvent {
  type: "annotation";
  sessionId: string;
  timestamp: number;
  startTime: number;
  endTime: number;
  label: "high" | "mid" | "low" | "wrong";
  annotatedAt: number;
}

export type LogEvent = HREvent | EDAEvent | FlowEvent | MarkerEvent | AnnotationEvent;

export interface SessionMeta {
  sessionId: string;
  startTime: number;
  deviceName: string | null;
  sensors: string[];
}

// ── Database operations ──────────────────────────────────────────────

let dbInstance: IDBDatabase | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "sessionId" });
      }

      if (!db.objectStoreNames.contains("events")) {
        const store = db.createObjectStore("events", { autoIncrement: true });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function saveSession(meta: SessionMeta): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function writeEvents(events: LogEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("events", "readwrite");
    const store = tx.objectStore("events");
    for (const event of events) {
      store.add(event);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSessionEvents(sessionId: string): Promise<LogEvent[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("events", "readonly");
    const index = tx.objectStore("events").index("sessionId");
    const request = index.getAll(sessionId);
    request.onsuccess = () => resolve(request.result as LogEvent[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllSessions(): Promise<SessionMeta[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const request = tx.objectStore("sessions").getAll();
    request.onsuccess = () => resolve(request.result as SessionMeta[]);
    request.onerror = () => reject(request.error);
  });
}

export async function exportSessionAsJSONL(sessionId: string): Promise<string> {
  const events = await getSessionEvents(sessionId);
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events.map((e) => JSON.stringify(e)).join("\n");
}

export async function exportAllSessionsAsJSONL(): Promise<string> {
  const sessions = await getAllSessions();
  const allEvents: LogEvent[] = [];
  for (const session of sessions) {
    const events = await getSessionEvents(session.sessionId);
    allEvents.push(...events);
  }
  allEvents.sort((a, b) => a.timestamp - b.timestamp);
  return allEvents.map((e) => JSON.stringify(e)).join("\n");
}
