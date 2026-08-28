import { MCP_ERROR_CODES } from "../contracts";
import type { JobFinding, JobMetricStatus, JobReport } from "../jobs/types";
import type { SolveTaskContext } from "./solve-task";
import { solveTask } from "./solve-task";
import { type ResponseMode } from "./compact-response";
import {
  advanceLoopProgress,
  shapeAgentResult,
  withHarnessLoop,
} from "./harness-loop";
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
import type { LoopStop } from "./loop-stop";
import {
  attachVerificationEnvelope,
  baselineFromProfileLastRun,
  ensureVerificationProfile,
  extractProfileId,
  extractTargetUrl,
  persistVerificationRun,
} from "./verification-loop";
import { randomUUID } from "crypto";

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
  /** Verify iteration (1 on first verify_task). */
  round?: number;
  maxRounds?: number;
  sameFindingsStreak?: number;
  stop?: LoopStop;
}

const STATUS_RANK: Record<JobMetricStatus, number> = {
  good: 3,
  needs_improvement: 2,
  poor: 1,
  unknown: 0,
};

function findingKey(f: JobFinding): string {
  return (f.findingId || `${f.workstream || ""}|${f.title}`).toLowerCase();
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
      `Gate: fail — ${remainingFixes.length} remaining fix(es); apply rank-1 loop.nextActions then verify_task again. Full list: loop.remainingFixes.`
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

function attachProgress(
  delta: VerifyDelta,
  baseline: unknown
): { delta: VerifyDelta; progress: ReturnType<typeof advanceLoopProgress> } {
  const progress = advanceLoopProgress({
    baseline,
    remainingFixes: delta.remainingFixes,
    gate: delta.gate,
    deltaStatus: delta.status,
  });
  const summary = [...delta.summary];
  if (progress.stop) {
    summary.push(`Stop: ${progress.stop.code} — ${progress.stop.message}`);
  } else if (delta.gate === "fail") {
    summary.push(
      `Round ${progress.round}/${progress.maxRounds}; sameFindingsStreak ${progress.sameFindingsStreak}/${progress.sameFindingsLimit}.`
    );
  }
  return {
    progress,
    delta: {
      ...delta,
      summary,
      round: progress.round,
      maxRounds: progress.maxRounds,
      sameFindingsStreak: progress.sameFindingsStreak,
      ...(progress.stop ? { stop: progress.stop } : {}),
    },
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
  code?: string;
  message?: string;
  hint?: unknown;
  nextActions?: string[];
  missing?: string[];
  exampleInput?: Record<string, unknown>;
  delta?: VerifyDelta;
  after?: unknown;
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
  mode: ResponseMode,
  opts?: { profileId?: string }
): Promise<VerifyTaskResult> {
  const profileId = opts?.profileId || extractProfileId(input);
  let effectiveBaseline = baseline;
  let profileMeta:
    | Awaited<ReturnType<typeof ensureVerificationProfile>>
    | undefined;

  if (profileId) {
    profileMeta = await ensureVerificationProfile({
      apiKey: ctx.apiKey,
      logger: ctx.logger,
      profileId,
      playbook: "verify",
      autoCreate: false,
    }).catch(() => undefined);

    if (!extractJobReport(effectiveBaseline) && profileMeta?.lastRunSnapshot) {
      const fromProfile = baselineFromProfileLastRun(profileMeta.lastRunSnapshot);
      if (fromProfile) {
        effectiveBaseline = fromProfile;
      }
    }
  }

  const before = extractJobReport(effectiveBaseline);
  if (!before) {
    return withHarnessLoop(
      {
        status: "need_input",
        code: MCP_ERROR_CODES.NEED_BASELINE,
        goal,
        message:
          "verify_task requires a usable baseline jobReport. Pass the prior solve_task or run_playbook result (or verify_task.after / a raw jobReport). When using profileId, run run_playbook first so lastRunSnapshot is stored.",
        hint: {
          baseline:
            "Pass the entire previous solve_task, run_playbook, or verify_task result as baseline.",
          profileId: profileId || undefined,
        },
        nextActions: [
          "Call solve_task or run_playbook first and keep the result",
          "Re-call verify_task with that entire result as baseline",
          profileId
            ? `Or run run_playbook with profileId ${profileId} first to populate the profile snapshot`
            : "Optional: pass profileId to auto-load last run snapshot after the first playbook",
        ],
        exampleInput: {
          baseline: {
            schemaVersion: "toolyour.jobReport@1",
            jobId: "…",
            findings: [],
            scores: {},
          },
        },
        missing: ["baseline"],
        ...(profileId ? { profileId } : {}),
      },
      "verify"
    );
  }

  const fresh = await solveTask(goal, input, ctx, "full");
  const after = extractJobReport(fresh);
  const { delta, progress } = attachProgress(
    diffJobReports(before, after),
    effectiveBaseline
  );
  const compactFresh = shapeAgentResult(fresh, mode, "run");
  const freshStatus =
    fresh && typeof fresh === "object"
      ? String((fresh as { status?: string }).status || "")
      : "";

  const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const payload: VerifyTaskResult = {
    status:
      freshStatus === "error" ||
      freshStatus === "partial" ||
      freshStatus === "suggest" ||
      freshStatus === "need_input" ||
      freshStatus === "need_workflow"
        ? freshStatus
        : progress.stop
          ? "stopped"
          : delta.gate === "pass"
            ? "verified"
            : delta.gate === "fail"
              ? "fail"
              : "continue",
    goal,
    delta,
    after: compactFresh,
    ...(profileId ? { profileId } : {}),
  };
  const wrapped = withHarnessLoop(payload, "verify", {
    baseline: effectiveBaseline,
    progress,
  }) as unknown as Record<string, unknown>;

  attachVerificationEnvelope(wrapped, {
    profileId: profileId || profileMeta?.profileId,
    targetUrl: extractTargetUrl(input) || after?.url,
    playbook: profileMeta?.profileId ? undefined : extractProfileId(input) ? "verify" : undefined,
    runId,
    baselineRunId: profileMeta?.lastPassRunId,
    delta,
    lastPassAt: profileMeta?.lastPassAt,
    lastPassGate: profileMeta?.lastPassGate,
    phase: "verify",
  });

  const loopGate = (wrapped.loop as { gate?: string } | undefined)?.gate;
  if (profileId || profileMeta?.profileId) {
    await persistVerificationRun({
      apiKey: ctx.apiKey,
      logger: ctx.logger,
      profileId: profileId || profileMeta?.profileId,
      runPayload: wrapped,
      runId,
      gate: loopGate as "pass" | "fail" | "unknown" | undefined,
    });
  }

  return wrapped as unknown as VerifyTaskResult;
}
