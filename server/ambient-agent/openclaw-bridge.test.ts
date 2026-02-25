/**
 * Tests for OpenClaw response validation hardening.
 *
 * Run: npx tsx server/ambient-agent/openclaw-bridge.test.ts
 */

import { queryOpenClaw } from "./openclaw-bridge";
import type { OpenClawConfig } from "./types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${name}: ${msg}`);
      failed++;
    });
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

const cfg: OpenClawConfig = {
  enabled: true,
  agentId: "flow-detector",
  timeoutMs: 4000,
  maxConsecutiveFailures: 3,
  fallbackCooldownMs: 10_000,
};

async function run(): Promise<void> {
  console.log("\nopenclaw-bridge validation hardening");

  await test("normalizes malformed 'action s' key to actions[] when shouldIntervene=false", async () => {
    const originalSpawn = require("child_process").spawn;
    require("child_process").spawn = function mockSpawn() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => true;
      process.nextTick(() => {
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              payloads: [
                {
                  text: JSON.stringify({
                    shouldIntervene: false,
                    "action s": [],
                    reasoning: "No sensor payload provided; cannot confirm flow state from context alone.",
                  }),
                },
              ],
            })
          )
        );
        proc.emit("close", 0);
      });
      return proc;
    };

    try {
      const result = await queryOpenClaw("test", cfg);
      assert(result.shouldIntervene === false, "shouldIntervene should remain false");
      assert(Array.isArray(result.actions), "actions should be an array");
      assert(result.actions.length === 0, "actions should normalize to []");
    } finally {
      require("child_process").spawn = originalSpawn;
    }
  });

  await test("normalizes missing actions to [] when shouldIntervene=false", async () => {
    const originalSpawn = require("child_process").spawn;
    require("child_process").spawn = function mockSpawn() {
      const { EventEmitter } = require("events");
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => true;
      process.nextTick(() => {
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              payloads: [
                {
                  text: JSON.stringify({
                    shouldIntervene: false,
                    reasoning: "Insufficient signal.",
                  }),
                },
              ],
            })
          )
        );
        proc.emit("close", 0);
      });
      return proc;
    };

    try {
      const result = await queryOpenClaw("test", cfg);
      assert(result.shouldIntervene === false, "shouldIntervene should remain false");
      assert(result.actions.length === 0, "missing actions should normalize to []");
    } finally {
      require("child_process").spawn = originalSpawn;
    }
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void run();
