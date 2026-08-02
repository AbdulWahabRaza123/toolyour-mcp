import type {
  JobFinding,
  JobMetricStatus,
  JobReport,
  PrioritizedAction,
} from "../jobs/types";
import type { SolveTaskContext } from "./solve-task";
import { solveTask } from "./solve-task";
import {
  applyResponseMode,
  type ResponseMode,
} from "./compact-response";

export type VerifyGate = "pass" | "fail" | "unknown";

export interface RemainingFix {
  rank: number;
  workstream: string;
  severity?: JobFinding["severity"];
  title: string;
  actions: string[];
  expectedImpact?: PrioritizedAction["expectedImpact"];
  source: "finding" | "prioritizedAction";
}

export interface VerifyNextAction {
  id: string;
  label: string;
  workstream?: string;
  severity?: JobFinding["severity"];
}

export interface VerifyDelta {
  status: "improved" | "regressed" | "unchanged" | "unknown";
  scoreDeltas: Array<{
    key: string;
    before: string | number;
    after: string | number;
    beforeStatus?: JobMetricStatus;
    afterStatus?: JobMetricStatus;
  }>;
  newFindings: JobFinding[];
  resolvedFindings: JobFinding[];
  /** Open findings on the fresh run (severity-sorted). */
  remainingFindings: JobFinding[];
  /** Machine-readable fixes agents should apply before re-verify. */
  remainingFixes: RemainingFix[];
  /** Short ordered actions for the host harness loop. */
  nextActions: VerifyNextAction[];
  /** pass = no high findings and no poor primary scores on after report. */
  gate: VerifyGate;
  summary: string[];
}

const STATUS_RANK: Record<JobMetricStatus, number> = {
  good: 3,
  needs_improvement: 2,
  poor: 1,
  unknown: 0,
};

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function findingKey(f: JobFinding): string {
  return `${f.workstream || ""}|${f.title}`.toLowerCase();
}

function sortFindings(findings: JobFinding[]): JobFinding[] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
  );
}

/**
 * Build remainingFixes from the fresh jobReport (findings + prioritizedActions).
 */
export function buildRemainingFixes(after: JobReport | null): RemainingFix[] {
  if (!after) return [];
  const fixes: RemainingFix[] = [];
  let rank = 1;

  for (const f of sortFindings(after.findings || [])) {
    const actions = (f.howToFix || []).map((s) => String(s).trim()).filter(Boolean);
    if (!actions.length && f.severity === "low") continue;
    fixes.push({
      rank: rank++,
      workstream: f.workstream || f.metric || "general",
      severity: f.severity,
      title: f.title,
      actions: actions.length ? actions : ["Investigate and remediate this finding, then re-run verify_task."],
      source: "finding",
    });
  }

  const covered = new Set(fixes.map((x) => x.title.toLowerCase()));
  for (const a of after.prioritizedActions || []) {
    const key = String(a.action || "").toLowerCase();
    if (!key || covered.has(key)) continue;
    if (fixes.some((f) => f.actions.some((x) => x.toLowerCase() === key))) continue;
    fixes.push({
      rank: rank++,
      workstream: a.workstream || "general",
      title: a.action,
      actions: [a.action],
      expectedImpact: a.expectedImpact,
      source: "prioritizedAction",
    });
  }

  return fixes.slice(0, 12);
}

export function buildNextActions(fixes: RemainingFix[]): VerifyNextAction[] {
  return fixes.slice(0, 5).map((f, i) => ({
    id: `fix_${i + 1}`,
    label: f.actions[0] || f.title,
    workstream: f.workstream,
    severity: f.severity,
  }));
}

export function computeVerifyGate(after: JobReport | null): VerifyGate {
  if (!after) return "unknown";
  const high = (after.findings || []).some((f) => f.severity === "high");
  const poor = Object.values(after.scores || {}).some((s) => s.status === "poor");
  if (high || poor) return "fail";
  return "pass";
}

function enrichDelta(
  base: Omit<VerifyDelta, "remainingFindings" | "remainingFixes" | "nextActions" | "gate">,
  after: JobReport | null
): VerifyDelta {
  const remainingFindings = sortFindings(after?.findings || []);
  const remainingFixes = buildRemainingFixes(after);
  const nextActions = buildNextActions(remainingFixes);
  const gate = computeVerifyGate(after);
  const summary = [...base.summary];
  if (gate === "pass") {
    summary.push("Gate: pass — no high-severity findings or poor scores on the fresh run.");
  } else if (gate === "fail") {
    summary.push(
      `Gate: fail — ${remainingFixes.length} remaining fix(es); apply delta.nextActions then verify_task again.`
    );
  }
  return {
    ...base,
    remainingFindings,
    remainingFixes,
    nextActions,
    gate,
    summary,
  };
}

/**
 * Peel common agent envelopes to a JobReport.
 */
export function extractJobReport(payload: unknown): JobReport | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.schemaVersion === "toolyour.jobReport@1") {
    return root as unknown as JobReport;
  }
  if (root.jobReport && typeof root.jobReport === "object") {
    return root.jobReport as JobReport;
  }
  if (
    root.execution &&
    typeof root.execution === "object" &&
    (root.execution as Record<string, unknown>).jobReport
  ) {
    return (root.execution as Record<string, unknown>).jobReport as JobReport;
  }
  // verify_task prior response: { status, delta, after }
  if (root.after !== undefined) {
    const nested = extractJobReport(root.after);
    if (nested) return nested;
  }
  // get_run / poll envelope: { runId, result: solve_task payload }
  if (root.result !== undefined) {
    const nested = extractJobReport(root.result);
    if (nested) return nested;
  }
  return null;
}

/**
 * Compare baseline jobReport to a fresh run — agent-facing delta only.
 * Uses metric status (good/needs_improvement/poor) for direction, not raw
 * numeric "higher is better" (latency-style numbers would invert that).
 */
export function diffJobReports(
  before: JobReport | null,
  after: JobReport | null
): VerifyDelta {
  if (!before || !after) {
    return enrichDelta(
      {
        status: "unknown",
        scoreDeltas: [],
        newFindings: after?.findings || [],
        resolvedFindings: [],
        summary: [
          "Could not compare — provide baseline.jobReport (or previous solve_task result) and a fresh run.",
        ],
      },
      after
    );
  }

  const keys = new Set([
    ...Object.keys(before.scores || {}),
    ...Object.keys(after.scores || {}),
  ]);
  const scoreDeltas: VerifyDelta["scoreDeltas"] = [];
  let improved = 0;
  let regressed = 0;

  for (const key of keys) {
    const bScore = before.scores?.[key];
    const aScore = after.scores?.[key];
    if (!bScore || !aScore) continue;
    if (bScore.value === aScore.value && bScore.status === aScore.status) {
      continue;
    }
    scoreDeltas.push({
      key,
      before: bScore.value,
      after: aScore.value,
      beforeStatus: bScore.status,
      afterStatus: aScore.status,
    });
    const bRank = STATUS_RANK[bScore.status] ?? 0;
    const aRank = STATUS_RANK[aScore.status] ?? 0;
    if (aRank > bRank) improved++;
    else if (aRank < bRank) regressed++;
  }

  const beforeKeys = new Set((before.findings || []).map(findingKey));
  const afterKeys = new Set((after.findings || []).map(findingKey));
  const newFindings = (after.findings || []).filter(
    (f) => !beforeKeys.has(findingKey(f))
  );
  const resolvedFindings = (before.findings || []).filter(
    (f) => !afterKeys.has(findingKey(f))
  );

  if (regressed > improved || newFindings.length > resolvedFindings.length) {
    return enrichDelta(
      {
        status: "regressed",
        scoreDeltas,
        newFindings,
        resolvedFindings,
        summary: [
          `Regression: ${newFindings.length} new finding(s), ${resolvedFindings.length} resolved.`,
          scoreDeltas[0]
            ? `Score move: ${scoreDeltas[0].key} ${scoreDeltas[0].before} → ${scoreDeltas[0].after}`
            : "Review new findings before shipping.",
        ],
      },
      after
    );
  }

  if (improved > 0 || resolvedFindings.length > 0) {
    return enrichDelta(
      {
        status: "improved",
        scoreDeltas,
        newFindings,
        resolvedFindings,
        summary: [
          `Improved: ${resolvedFindings.length} finding(s) resolved, ${newFindings.length} new.`,
          scoreDeltas[0]
            ? `Score move: ${scoreDeltas[0].key} ${scoreDeltas[0].before} → ${scoreDeltas[0].after}`
            : "Scores stable or better.",
        ],
      },
      after
    );
  }

  return enrichDelta(
    {
      status: "unchanged",
      scoreDeltas,
      newFindings,
      resolvedFindings,
      summary: ["No material score or finding changes vs baseline."],
    },
    after
  );
}

export interface VerifyTaskResult {
  status: string;
  goal: string;
  delta: VerifyDelta;
  after: unknown;
}

/**
 * Re-run goal at full fidelity, compare to baseline, then shape `after` with responseMode.
 * Propagates fresh-run terminals (error/partial/suggest/…) instead of always saying verified.
 */
export async function executeVerifyTask(
  goal: string,
  input: Record<string, unknown>,
  baseline: unknown,
  ctx: SolveTaskContext,
  mode: ResponseMode
): Promise<VerifyTaskResult> {
  const before = extractJobReport(baseline);
  const fresh = await solveTask(goal, input, ctx, "full");
  const after = extractJobReport(fresh);
  const delta = diffJobReports(before, after);
  const compactFresh = applyResponseMode(fresh, mode);
  const freshStatus =
    fresh && typeof fresh === "object"
      ? String((fresh as { status?: string }).status || "")
      : "";

  if (
    freshStatus === "error" ||
    freshStatus === "partial" ||
    freshStatus === "suggest" ||
    freshStatus === "need_input" ||
    freshStatus === "need_workflow"
  ) {
    return {
      status: freshStatus,
      goal,
      delta,
      after: compactFresh,
    };
  }

  return {
    status: "verified",
    goal,
    delta,
    after: compactFresh,
  };
}
