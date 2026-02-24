import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { InterventionLogger } from "./logger";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}: ${msg}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

console.log("\nlogger tests");

async function run(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ambient-logger-test-"));
  const logPath = join(dir, "interventions.jsonl");

  try {
    await test("logs decision snapshot with required fields", async () => {
      const logger = new InterventionLogger(logPath);
      const context = { trigger: "stress", hr: 91 };
      const decision = { shouldIntervene: true, actions: [{ type: "send_push" }] };

      await logger.logDecisionSnapshot({
        context,
        decision,
        sent: false,
        deferred_until: "2026-02-24T18:30:00.000Z",
      });

      const content = await readFile(logPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      assert(entries.length === 1, "expected exactly one log entry");

      const entry = entries[0] as {
        type?: string;
        context?: unknown;
        decision?: unknown;
        sent?: boolean;
        deferred_until?: string | null;
      };
      assert(entry.type === "decision_snapshot", "expected decision_snapshot type");
      assert(JSON.stringify(entry.context) === JSON.stringify(context), "context mismatch");
      assert(JSON.stringify(entry.decision) === JSON.stringify(decision), "decision mismatch");
      assert(entry.sent === false, "sent mismatch");
      assert(
        entry.deferred_until === "2026-02-24T18:30:00.000Z",
        "deferred_until mismatch"
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
