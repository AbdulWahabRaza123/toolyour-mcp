import type { JobFinding, JobMetricStatus, JobReport } from "../jobs/types";
import type { SolveTaskContext } from "./solve-task";
import { solveTask } from "./solve-task";
import { type ResponseMode } from "./compact-response";
import { shapeAgentResult, withHarnessLoop } from "./harness-loop";
import {
  buildNextActions,
  buildRemainingFixes,
  computeVerifyGate,
  extractJobReport,
  sortFindings,
  type RemainingFix,
  type VerifyGate,
  type VerifyNextAction,
} from "./job-report";

export type {
  RemainingFix,
  RemainingFixPatchType,
  VerifyGate,
  VerifyNextAction,
} from "./job-report";
export {
  buildNextActions,
  buildRemainingFixes,
  computeVerifyGate,
  extractJobReport,
  inferPatchType,
} from "./job-report";

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

function findingKey(f: JobFinding): string {
  return `${f.workstream || ""}|${f.title}`.toLowerCase();
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
      `Gate: fail — ${remainingFixes.length} remaining fix(es); apply loop.remainingFixes (or delta.nextActions) then verify_task again.`
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
  const compactFresh = shapeAgentResult(fresh, mode, "run");
  const freshStatus =
    fresh && typeof fresh === "object"
      ? String((fresh as { status?: string }).status || "")
      : "";

  const payload: VerifyTaskResult = {
    status:
      freshStatus === "error" ||
      freshStatus === "partial" ||
      freshStatus === "suggest" ||
      freshStatus === "need_input" ||
      freshStatus === "need_workflow"
        ? freshStatus
        : "verified",
    goal,
    delta,
    after: compactFresh,
  };
  return withHarnessLoop(payload, "verify");
}
