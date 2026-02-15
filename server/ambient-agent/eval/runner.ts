/**
 * Eval Runner
 *
 * Runs eval cases against a model via:
 * 1. OpenClaw agent CLI (--local or gateway)
 * 2. Direct ollama API
 * 3. OpenRouter API (DeepSeek, etc)
 *
 * Usage:
 *   npx tsx server/ambient-agent/eval/runner.ts [options]
 *
 * Options:
 *   --backend <openclaw|ollama|openrouter>  (default: ollama)
 *   --model <model-id>                      (default: qwen32b-q6-16k)
 *   --soul <path-to-soul.md>                (default: current SOUL.md)
 *   --tag <variant-name>                    (default: "default")
 *   --cases <comma-sep-ids>                 (default: all)
 *   --output <path>                         (default: stdout + ./eval-results/)
 *   --parallel <n>                          (default: 1)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { EVAL_CASES } from "./cases";
import { scoreCase, computeReport, type CaseResult, type EvalReport } from "./scorer";

// ── CLI Args ────────────────────────────────────────────────────────

interface RunConfig {
  backend: "openclaw" | "ollama" | "openrouter";
  model: string;
  soulPath: string;
  tag: string;
  caseIds: string[] | null;  // null = all
  outputDir: string;
  parallel: number;
  codeDQ: boolean;  // enforce disqualifiers in code before model call
}

function parseArgs(): RunConfig {
  const args = process.argv.slice(2);
  const config: RunConfig = {
    backend: "ollama",
    model: "qwen3-32b-16k",
    soulPath: "/home/michael/flow-detector/.openclaw-workspace/SOUL.md",
    tag: "default",
    caseIds: null,
    outputDir: "./eval-results",
    parallel: 1,
    codeDQ: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--backend": config.backend = args[++i] as RunConfig["backend"]; break;
      case "--model": config.model = args[++i]; break;
      case "--soul": config.soulPath = args[++i]; break;
      case "--tag": config.tag = args[++i]; break;
      case "--cases": config.caseIds = args[++i].split(","); break;
      case "--output": config.outputDir = args[++i]; break;
      case "--parallel": config.parallel = parseInt(args[++i]); break;
      case "--code-dq": config.codeDQ = true; break;
    }
  }

  return config;
}

// ── Backend: Ollama ─────────────────────────────────────────────────

async function runOllama(
  systemPrompt: string,
  userMessage: string,
  model: string
): Promise<{ output: string; latencyMs: number }> {
  const start = Date.now();

  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: 4096,
      },
    }),
  });

  const data = await response.json() as { message?: { content: string }; error?: string };
  const latencyMs = Date.now() - start;

  if (data.error) throw new Error(`Ollama: ${data.error}`);
  return { output: data.message?.content || "", latencyMs };
}

// ── Backend: OpenRouter ─────────────────────────────────────────────

async function runOpenRouter(
  systemPrompt: string,
  userMessage: string,
  model: string
): Promise<{ output: string; latencyMs: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const start = Date.now();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://flow-detector.local",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 512,
    }),
  });

  const data = await response.json() as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };
  const latencyMs = Date.now() - start;

  if (data.error) throw new Error(`OpenRouter: ${data.error.message}`);
  return { output: data.choices?.[0]?.message?.content || "", latencyMs };
}

// ── Backend: OpenClaw CLI ───────────────────────────────────────────

async function runOpenClaw(
  _systemPrompt: string,
  userMessage: string,
  _model: string
): Promise<{ output: string; latencyMs: number }> {
  const { spawn } = await import("child_process");
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn("openclaw", [
      "agent",
      "--agent", "flow-detector",
      "--local",
      "--session-id", `eval-${Date.now()}`,
      "--message", userMessage,
      "--json",
      "--timeout", "60",
    ], { timeout: 65000 });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("close", (code) => {
      const latencyMs = Date.now() - start;

      if (code !== 0) {
        reject(new Error(`OpenClaw exit ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      // Extract text from payloads envelope
      try {
        const envelope = JSON.parse(stdout);
        const text = envelope?.payloads?.[0]?.text || envelope?.result?.payloads?.[0]?.text || stdout;
        resolve({ output: text, latencyMs });
      } catch {
        resolve({ output: stdout, latencyMs });
      }
    });

    child.on("error", reject);
  });
}

// ── Code-Side Disqualifiers ─────────────────────────────────────────
// These mirror the checks in agent.ts that run BEFORE the model is called.
// Moving deterministic boolean checks to code prevents model failures.

import type { OpenClawContext } from "../openclaw-context";

function codeDisqualify(context: OpenClawContext): { disqualified: boolean; reason: string } {
  const { sensors, calendar, agentState, detections } = context;

  // Watch disconnected
  if (!sensors.watchConnected) {
    return { disqualified: true, reason: "Watch disconnected — go silent" };
  }

  // No baseline
  if (!context.baseline) {
    return { disqualified: true, reason: "No baseline — can't make informed decisions" };
  }

  // In meeting (calendar)
  if (calendar?.inMeeting) {
    return { disqualified: true, reason: `In meeting: ${calendar.currentMeeting}` };
  }

  // Meeting starting soon (<5 min)
  if (calendar && calendar.minutesToNext !== null && calendar.minutesToNext < 5) {
    return { disqualified: true, reason: `Meeting in ${calendar.minutesToNext} min` };
  }

  // Null calendar = conservative (treat as potential meeting)
  if (calendar === null) {
    return { disqualified: true, reason: "Calendar unavailable — being conservative" };
  }

  // Daily limit reached
  if (agentState.interventionsToday >= agentState.maxInterventions) {
    return { disqualified: true, reason: "Daily intervention limit reached" };
  }

  // Recent intervention (<2h)
  if (agentState.lastInterventionHoursAgo !== null && agentState.lastInterventionHoursAgo < 2) {
    return { disqualified: true, reason: `Last intervention ${agentState.lastInterventionHoursAgo}h ago — too recent` };
  }

  // Quiet hours / night
  if (agentState.dayPart === "night") {
    return { disqualified: true, reason: "Night time — quiet hours" };
  }

  // Lunch break
  if (agentState.dayPart === "lunch") {
    return { disqualified: true, reason: "Lunch break — leave user alone" };
  }

  // Checkin already offered today (for stress cases)
  if (detections.stress.checkinOfferedToday && detections.stress.isElevated) {
    return { disqualified: true, reason: "Checkin already offered today" };
  }

  // Reflection already offered today
  if (detections.recovery.reflectionOfferedToday && detections.recovery.recoveryDetected) {
    return { disqualified: true, reason: "Reflection already offered today" };
  }

  return { disqualified: false, reason: "" };
}

// ── Runner ──────────────────────────────────────────────────────────

type BackendFn = (system: string, user: string, model: string) => Promise<{ output: string; latencyMs: number }>;

const BACKENDS: Record<string, BackendFn> = {
  ollama: runOllama,
  openrouter: runOpenRouter,
  openclaw: runOpenClaw,
};

async function runCase(
  evalCase: typeof EVAL_CASES[0],
  backendFn: BackendFn,
  systemPrompt: string,
  model: string,
  codeDQ: boolean = false
): Promise<CaseResult> {
  // Code-side disqualifier check (mirrors agent.ts pre-filters)
  if (codeDQ) {
    const dq = codeDisqualify(evalCase.context);
    if (dq.disqualified) {
      const syntheticOutput = JSON.stringify({
        shouldIntervene: false,
        actions: [],
        reasoning: `[CODE-DQ] ${dq.reason}`,
      });
      return scoreCase(evalCase, syntheticOutput, 0);
    }
  }

  const userMessage = JSON.stringify(evalCase.context);

  try {
    const { output, latencyMs } = await backendFn(systemPrompt, userMessage, model);
    return scoreCase(evalCase, output, latencyMs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      caseId: evalCase.id,
      caseName: evalCase.name,
      dimensions: evalCase.dimensions,
      rawOutput: `ERROR: ${msg}`,
      parsed: null,
      parseError: msg,
      checks: { schema: false, disqualifier: null, copy: null, threshold: null, action: null },
      latencyMs: 0,
      notes: [`Backend error: ${msg}`],
    };
  }
}

async function runBatch(
  cases: typeof EVAL_CASES,
  backendFn: BackendFn,
  systemPrompt: string,
  model: string,
  parallel: number,
  codeDQ: boolean = false
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  if (parallel <= 1) {
    // Sequential
    for (let i = 0; i < cases.length; i++) {
      const evalCase = cases[i];
      process.stdout.write(`  [${i + 1}/${cases.length}] ${evalCase.id}: ${evalCase.name}...`);
      const result = await runCase(evalCase, backendFn, systemPrompt, model, codeDQ);
      const status = result.checks.schema ? (result.notes.length === 0 ? "✓" : "~") : "✗";
      console.log(` ${status} (${(result.latencyMs / 1000).toFixed(1)}s)`);
      results.push(result);
    }
  } else {
    // Parallel batches
    for (let i = 0; i < cases.length; i += parallel) {
      const batch = cases.slice(i, i + parallel);
      const batchResults = await Promise.all(
        batch.map(c => runCase(c, backendFn, systemPrompt, model, codeDQ))
      );
      for (const r of batchResults) {
        const status = r.checks.schema ? (r.notes.length === 0 ? "✓" : "~") : "✗";
        console.log(`  ${r.caseId}: ${r.caseName} ${status} (${(r.latencyMs / 1000).toFixed(1)}s)`);
      }
      results.push(...batchResults);
    }
  }

  return results;
}

// ── Output Formatting ───────────────────────────────────────────────

function printReport(report: EvalReport): void {
  console.log("\n" + "═".repeat(60));
  console.log(`  EVAL REPORT: ${report.model} (${report.soulVariant})`);
  console.log("═".repeat(60));

  console.log("\n  Dimension Scores:");
  console.log("  " + "─".repeat(56));

  for (const d of report.dimensions) {
    const bar = "█".repeat(d.score) + "░".repeat(5 - d.score);
    console.log(`  ${d.dimension.padEnd(14)} ${bar} ${d.score}/5  ${d.details}`);
  }

  console.log("  " + "─".repeat(56));
  console.log(`  COMPOSITE: ${report.composite}/30`);
  console.log(`  Latency: p50=${(report.latencyStats.p50 / 1000).toFixed(1)}s  p95=${(report.latencyStats.p95 / 1000).toFixed(1)}s  mean=${(report.latencyStats.mean / 1000).toFixed(1)}s`);

  // Show failures
  const failures = report.cases.filter(c => c.notes.length > 0);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) {
      console.log(`    ${f.caseId}: ${f.notes.join("; ")}`);
    }
  }

  // Qualification
  const minScore = Math.min(...report.dimensions.map(d => d.score));
  if (minScore <= 1) {
    console.log("\n  ⛔ DISQUALIFIED — dimension at 1");
  } else if (report.composite >= 27) {
    console.log("\n  ✅ SHIP READY (≥27/30)");
  } else if (report.composite >= 24) {
    console.log("\n  ⚠️  VIABLE (≥24/30) — needs prompt/code tuning");
  } else {
    console.log("\n  ❌ BELOW THRESHOLD (<24/30)");
  }

  console.log("═".repeat(60) + "\n");
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  console.log(`\nFlow Detector Agent Eval`);
  console.log(`  Backend:  ${config.backend}`);
  console.log(`  Model:    ${config.model}`);
  console.log(`  SOUL:     ${config.soulPath}`);
  console.log(`  Tag:      ${config.tag}`);
  console.log(`  Parallel: ${config.parallel}`);
  console.log(`  Code DQ:  ${config.codeDQ ? "ON" : "OFF"}`);

  // Load SOUL.md as system prompt
  const systemPrompt = readFileSync(config.soulPath, "utf-8");
  console.log(`  Prompt:   ${systemPrompt.length} chars`);

  // Select cases
  let cases = EVAL_CASES;
  if (config.caseIds) {
    cases = EVAL_CASES.filter(c => config.caseIds!.includes(c.id));
    console.log(`  Cases:    ${cases.length} (filtered)`);
  } else {
    console.log(`  Cases:    ${cases.length} (all)`);
  }

  const backendFn = BACKENDS[config.backend];
  if (!backendFn) {
    console.error(`Unknown backend: ${config.backend}`);
    process.exit(1);
  }

  console.log(`\nRunning ${cases.length} cases...\n`);

  const results = await runBatch(cases, backendFn, systemPrompt, config.model, config.parallel, config.codeDQ);

  const report = computeReport(config.model, config.tag, results);
  printReport(report);

  // Save results
  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }

  const filename = `${config.model.replace(/[/:]/g, "-")}_${config.tag}_${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
  const outputPath = `${config.outputDir}/${filename}`;

  // Strip rawOutput from saved results to keep file manageable
  const savedReport = {
    ...report,
    cases: report.cases.map(c => ({
      ...c,
      rawOutput: c.rawOutput.slice(0, 500),  // truncate
    })),
  };

  writeFileSync(outputPath, JSON.stringify(savedReport, null, 2));
  console.log(`Results saved: ${outputPath}`);
}

main().catch((e) => {
  console.error("Eval failed:", e);
  process.exit(1);
});
