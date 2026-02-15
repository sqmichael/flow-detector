/**
 * Eval Scorer
 *
 * Validates model responses against expected outcomes and scores
 * each dimension 1-5. Also checks copy rules via pattern matching.
 */

import type { EvalCase, Dimension, ExpectedOutcome } from "./cases";

// ── Copy Rule Patterns ──────────────────────────────────────────────

/** Words/patterns that violate copy rules */
const COPY_VIOLATIONS = {
  emotionLabels: [
    /\bstress(ed|ful)?\b/i,
    /\btens(e|ion)\b/i,
    /\banxi(ous|ety)\b/i,
    /\bcalm(er|ing)?\b/i,
    /\brelax(ed|ing)?\b/i,
    /\bupset\b/i,
    /\bworr(y|ied)\b/i,
    /\bagitat(ed|ion)\b/i,
    /\bfrustrat(ed|ion)\b/i,
    /\boverwhelm(ed|ing)?\b/i,
    /\byou seem\b/i,
    /\byou('re| are) feeling\b/i,
    /\bnoticing (some |)tension\b/i,
    /\bnoticing (some |)stress\b/i,
  ],
  biometricData: [
    /\bHR\s*\d/i,
    /\bHRV\s*\d/i,
    /\bbpm\b/i,
    /\d+\s*ms\b/,
    /\bEDA\b/i,
    /\bSCL\b/i,
    /µS/,
    /\bheart rate\b/i,
    /\bskin conductance\b/i,
  ],
  prescriptiveAdvice: [
    /\btake a walk\b/i,
    /\bgo for a walk\b/i,
    /\btry (to |)(breath|meditat)/i,
    /\byou (should|need to|must)\b/i,
    /\bwalk and talk\b/i,
    /\bdo some stretching\b/i,
  ],
  diagnosis: [
    /\bdetected for \d+/i,
    /\bfor \d+ minutes\b/i,
    /\bstress (detected|pattern)\b/i,
    /\belevated for\b/i,
    /\bsustained \w+ for \d+/i,
  ],
};

export interface CopyViolation {
  category: string;
  pattern: string;
  matchedText: string;
}

function checkCopyRules(message: string): CopyViolation[] {
  const violations: CopyViolation[] = [];

  for (const [category, patterns] of Object.entries(COPY_VIOLATIONS)) {
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        violations.push({
          category,
          pattern: pattern.source,
          matchedText: match[0],
        });
      }
    }
  }

  return violations;
}

// ── Schema Validation ───────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set([
  "enable_focus_mode", "disable_focus_mode", "send_haptic",
  "send_push", "trigger_call", "send_reflection", "no_action",
]);

interface ParsedResponse {
  shouldIntervene: boolean;
  actions: Array<{ type: string; message?: string; priority?: string; pattern?: string }>;
  reasoning: string;
}

function parseResponse(raw: string): { parsed: ParsedResponse | null; parseError: string | null } {
  try {
    // Strip thinking blocks (Qwen3, Phi-4, etc.)
    let cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();

    // Find JSON object if wrapped in text
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    const obj = JSON.parse(cleaned);

    if (typeof obj.shouldIntervene !== "boolean") {
      return { parsed: null, parseError: "missing shouldIntervene boolean" };
    }
    if (!Array.isArray(obj.actions)) {
      return { parsed: null, parseError: "missing actions array" };
    }
    if (typeof obj.reasoning !== "string") {
      return { parsed: null, parseError: "missing reasoning string" };
    }

    for (const action of obj.actions) {
      if (!action.type || !VALID_ACTION_TYPES.has(action.type)) {
        return { parsed: null, parseError: `invalid action type: ${action.type}` };
      }
    }

    return { parsed: obj as ParsedResponse, parseError: null };
  } catch (e) {
    return { parsed: null, parseError: `JSON parse: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── Per-Case Scoring ────────────────────────────────────────────────

export interface CaseResult {
  caseId: string;
  caseName: string;
  dimensions: Dimension[];
  /** Raw model output */
  rawOutput: string;
  /** Parsed response (null if schema failure) */
  parsed: ParsedResponse | null;
  parseError: string | null;
  /** Per-dimension pass/fail */
  checks: {
    schema: boolean;
    disqualifier: boolean | null;  // null if not tested
    copy: { passed: boolean; violations: CopyViolation[] } | null;
    threshold: boolean | null;
    action: boolean | null;
  };
  /** Latency in ms */
  latencyMs: number;
  /** Notes for debugging */
  notes: string[];
}

export function scoreCase(
  evalCase: EvalCase,
  rawOutput: string,
  latencyMs: number
): CaseResult {
  const notes: string[] = [];
  const { parsed, parseError } = parseResponse(rawOutput);

  const checks: CaseResult["checks"] = {
    schema: parsed !== null,
    disqualifier: null,
    copy: null,
    threshold: null,
    action: null,
  };

  if (!parsed) {
    notes.push(`Schema failure: ${parseError}`);
    return {
      caseId: evalCase.id,
      caseName: evalCase.name,
      dimensions: evalCase.dimensions,
      rawOutput,
      parsed: null,
      parseError,
      checks,
      latencyMs,
      notes,
    };
  }

  const expected = evalCase.expected;

  // Disqualifier check
  if (evalCase.dimensions.includes("disqualifier")) {
    const correct = parsed.shouldIntervene === expected.shouldIntervene;
    checks.disqualifier = correct;
    if (!correct) {
      notes.push(`Disqualifier: expected shouldIntervene=${expected.shouldIntervene}, got ${parsed.shouldIntervene}`);
    }
  }

  // Threshold check
  if (evalCase.dimensions.includes("threshold")) {
    const correct = parsed.shouldIntervene === expected.shouldIntervene;
    checks.threshold = correct;
    if (!correct) {
      notes.push(`Threshold: expected shouldIntervene=${expected.shouldIntervene}, got ${parsed.shouldIntervene}`);
    }
  }

  // Action check
  if (evalCase.dimensions.includes("action") && parsed.shouldIntervene) {
    let actionCorrect = true;

    // Check required action types
    if (expected.actionTypes) {
      const actualTypes = parsed.actions.map(a => a.type).sort();
      const expectedTypes = [...expected.actionTypes].sort();
      if (JSON.stringify(actualTypes) !== JSON.stringify(expectedTypes)) {
        actionCorrect = false;
        notes.push(`Action types: expected [${expectedTypes}], got [${actualTypes}]`);
      }
    }

    // Check forbidden action types
    if (expected.forbiddenActions) {
      for (const forbidden of expected.forbiddenActions) {
        if (parsed.actions.some(a => a.type === forbidden)) {
          actionCorrect = false;
          notes.push(`Forbidden action present: ${forbidden}`);
        }
      }
    }

    checks.action = actionCorrect;
  } else if (evalCase.dimensions.includes("action") && !parsed.shouldIntervene) {
    // If not intervening, check that forbidden actions aren't somehow present
    if (expected.forbiddenActions && parsed.actions.length > 0) {
      checks.action = false;
      notes.push("Actions present despite shouldIntervene=false");
    } else {
      checks.action = expected.shouldIntervene === false;
    }
  }

  // Copy rules check
  if (evalCase.dimensions.includes("copy") && expected.checkCopyRules && parsed.shouldIntervene) {
    const allMessages = parsed.actions
      .filter(a => a.message)
      .map(a => a.message!);

    const allViolations: CopyViolation[] = [];
    for (const msg of allMessages) {
      allViolations.push(...checkCopyRules(msg));
    }

    checks.copy = {
      passed: allViolations.length === 0,
      violations: allViolations,
    };

    if (allViolations.length > 0) {
      notes.push(`Copy violations: ${allViolations.map(v => `${v.category}:"${v.matchedText}"`).join(", ")}`);
    }
  }

  return {
    caseId: evalCase.id,
    caseName: evalCase.name,
    dimensions: evalCase.dimensions,
    rawOutput,
    parsed,
    parseError,
    checks,
    latencyMs,
    notes,
  };
}

// ── Aggregate Scoring ───────────────────────────────────────────────

export interface DimensionScore {
  dimension: Dimension | "latency";
  score: number;  // 1-5
  passed: number;
  total: number;
  details: string;
}

export interface EvalReport {
  model: string;
  soulVariant: string;
  timestamp: string;
  dimensions: DimensionScore[];
  composite: number;  // out of 30
  cases: CaseResult[];
  latencyStats: { p50: number; p95: number; mean: number };
}

export function computeReport(
  model: string,
  soulVariant: string,
  cases: CaseResult[]
): EvalReport {
  // Schema scoring
  const schemaTotal = cases.length;
  const schemaPassed = cases.filter(c => c.checks.schema).length;
  const schemaRate = schemaPassed / schemaTotal;
  const schemaScore = schemaRate >= 1.0 ? 5 : schemaRate >= 0.95 ? 4 : schemaRate >= 0.90 ? 3 : schemaRate >= 0.80 ? 2 : 1;

  // Disqualifier scoring
  const dqCases = cases.filter(c => c.checks.disqualifier !== null);
  const dqPassed = dqCases.filter(c => c.checks.disqualifier === true).length;
  const dqTotal = dqCases.length;
  const dqMisses = dqTotal - dqPassed;
  const dqScore = dqMisses === 0 ? 5 : dqMisses === 1 ? 4 : dqMisses === 2 ? 3 : dqMisses <= 4 ? 2 : 1;

  // Copy rule scoring
  const copyCases = cases.filter(c => c.checks.copy !== null);
  const copyPassed = copyCases.filter(c => c.checks.copy!.passed).length;
  const copyTotal = copyCases.length;
  const copyViolations = copyTotal - copyPassed;
  const copyScore = copyViolations === 0 ? 5 : copyViolations === 1 ? 4 : copyViolations <= 3 ? 3 : copyViolations <= 5 ? 2 : 1;

  // Threshold scoring
  const thCases = cases.filter(c => c.checks.threshold !== null);
  const thPassed = thCases.filter(c => c.checks.threshold === true).length;
  const thTotal = thCases.length;
  const thMisses = thTotal - thPassed;
  const thScore = thMisses === 0 ? 5 : thMisses === 1 ? 4 : thMisses <= 3 ? 3 : thMisses <= 4 ? 2 : 1;

  // Action scoring
  const acCases = cases.filter(c => c.checks.action !== null);
  const acPassed = acCases.filter(c => c.checks.action === true).length;
  const acTotal = acCases.length;
  const acMisses = acTotal - acPassed;
  const acScore = acMisses === 0 ? 5 : acMisses === 1 ? 4 : acMisses <= 3 ? 3 : acMisses <= 4 ? 2 : 1;

  // Latency scoring
  const latencies = cases.map(c => c.latencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const latScore = p95 < 15000 ? 5 : p95 < 20000 ? 4 : p95 < 25000 ? 3 : p95 < 35000 ? 2 : 1;

  const dimensions: DimensionScore[] = [
    { dimension: "schema", score: schemaScore, passed: schemaPassed, total: schemaTotal, details: `${schemaPassed}/${schemaTotal} valid` },
    { dimension: "disqualifier", score: dqScore, passed: dqPassed, total: dqTotal, details: `${dqPassed}/${dqTotal} correct (${dqMisses} misses)` },
    { dimension: "copy", score: copyScore, passed: copyPassed, total: copyTotal, details: `${copyPassed}/${copyTotal} clean (${copyViolations} violations)` },
    { dimension: "threshold", score: thScore, passed: thPassed, total: thTotal, details: `${thPassed}/${thTotal} correct (${thMisses} misses)` },
    { dimension: "action", score: acScore, passed: acPassed, total: acTotal, details: `${acPassed}/${acTotal} correct (${acMisses} misses)` },
    { dimension: "latency", score: latScore, passed: 0, total: 0, details: `p50=${(p50/1000).toFixed(1)}s p95=${(p95/1000).toFixed(1)}s` },
  ];

  const composite = dimensions.reduce((sum, d) => sum + d.score, 0);

  return {
    model,
    soulVariant,
    timestamp: new Date().toISOString(),
    dimensions,
    composite,
    cases,
    latencyStats: { p50, p95, mean },
  };
}
