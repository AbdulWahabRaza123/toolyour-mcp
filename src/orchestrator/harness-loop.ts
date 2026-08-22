import {
  applyResponseMode,
  parseResponseMode,
  type ResponseMode,
} from "./compact-response";

export type { ResponseMode };
export { parseResponseMode };

import {
  buildNextActions,
  buildRemainingFixes,
  computeVerifyGate,
  extractJobReport,
  type RemainingFix,
  type VerifyGate,
  type VerifyNextAction,
} from "./job-report";
import {
  decideRunLoop,
  extractWorkflowId,
  type LoopEligibility,
} from "./loop-scope";
import {
  advanceLoopProgress,
  initialLoopProgress,
  type LoopProgress,
  type LoopStop,
} from "./loop-stop";

export type { LoopProgress, LoopStop } from "./loop-stop";
export {
  DEFAULT_MAX_VERIFY_ROUNDS,
  DEFAULT_SAME_FINDINGS_LIMIT,
  LOOP_MAX_ROUNDS,
  LOOP_SAME_FINDINGS,
  advanceLoopProgress,
  extractLoopProgress,
  fingerprintFromFixes,
  initialLoopProgress,
} from "./loop-stop";

export const LOOP_NEXT_FAIL =
  "Apply ONLY the rank-1 item in loop.nextActions (see patchType, acceptance, roleHint). Full backlog: loop.remainingFixes. Change the host workspace (editor/git/config) — do not invoke_tool for the same job. Then call verify_task with this entire result as baseline until loop.gate is pass, or stop when loop.stop / loop.initiate is false.";

const CREDITS_PER_TOOL_EST = 2;

export interface LoopReceipt {
  round: number;
  maxRounds: number;
  /** Rough estimate from tools used this run — SaaS bills 1–10 per tool. */
  estimatedCredits: number;
  note: string;
}

export interface HarnessLoop extends LoopEligibility {
  phase: "run" | "verify";
  gate: VerifyGate;
  remainingFixes: RemainingFix[];
  nextActions: VerifyNextAction[];
  next: string;
  round: number;
  maxRounds: number;
  findingFingerprint: string;
  sameFindingsStreak: number;
  sameFindingsLimit: number;
  stop?: LoopStop;
  receipt: LoopReceipt;
}

function estimateCreditsFromPayload(payload: unknown): number {
  const report = extractJobReport(payload);
  if (report?.toolsUsed?.length) {
    return report.toolsUsed.length * CREDITS_PER_TOOL_EST;
  }
  if (!payload || typeof payload !== "object") return 0;
  const root = payload as Record<string, unknown>;
  const exec = root.execution;
  if (exec && typeof exec === "object") {
    const steps = (exec as { completedSteps?: unknown }).completedSteps;
    if (Array.isArray(steps)) return steps.length * CREDITS_PER_TOOL_EST;
  }
  if (Array.isArray(root.completedSteps)) {
    return root.completedSteps.length * CREDITS_PER_TOOL_EST;
  }
  return 0;
}

function assembleLoop(
  payload: unknown,
  phase: "run" | "verify",
  remainingFixes: RemainingFix[],
  nextActions: VerifyNextAction[],
  gate: VerifyGate,
  progress: LoopProgress
): HarnessLoop {
  let decided = decideRunLoop({
    status:
      payload && typeof payload === "object"
        ? String((payload as { status?: string }).status || "")
        : "",
    workflowId: extractWorkflowId(payload),
    hasJobReport:
      Boolean(extractJobReport(payload)) ||
      remainingFixes.length > 0 ||
      gate === "pass" ||
      gate === "fail",
    gate,
    remainingFixes,
  });

  if (progress.stop) {
    decided = {
      initiate: false,
      inScope: true,
      reason: progress.stop.message,
    };
  }

  const estimatedCredits = estimateCreditsFromPayload(payload);

  return {
    ...decided,
    phase,
    gate,
    remainingFixes,
    nextActions: decided.initiate ? nextActions : [],
    next: decided.initiate ? LOOP_NEXT_FAIL : decided.reason,
    round: progress.round,
    maxRounds: progress.maxRounds,
    findingFingerprint: progress.findingFingerprint,
    sameFindingsStreak: progress.sameFindingsStreak,
    sameFindingsLimit: progress.sameFindingsLimit,
    ...(progress.stop ? { stop: progress.stop } : {}),
    receipt: {
      round: progress.round,
      maxRounds: progress.maxRounds,
      estimatedCredits,
      note:
        "estimatedCredits is a rough count from tools used (≈2 each); actual debit is 1–10 credits per tool on the shared REST+MCP quota.",
    },
  };
}

function payloadRunStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  const rootStatus = String(root.status || "");
  if (rootStatus) return rootStatus;
  if (root.execution && typeof root.execution === "object") {
    return String((root.execution as { status?: string }).status || "");
  }
  return "";
}

/**
 * Incomplete runs must never advertise gate=pass (empty findings look like a clean bill).
 */
export function resolveRunGate(
  payload: unknown,
  reportGate: VerifyGate
): VerifyGate {
  const status = payloadRunStatus(payload);
  if (status === "partial" || status === "error") {
    return "fail";
  }
  return reportGate;
}

export function buildHarnessLoopFromReport(
  payload: unknown,
  phase: "run" | "verify"
): HarnessLoop {
  const report = extractJobReport(payload);
  const remainingFixes = buildRemainingFixes(report);
  const nextActions = buildNextActions(remainingFixes);
  const gate = resolveRunGate(payload, computeVerifyGate(report));
  const progress = initialLoopProgress(remainingFixes);
  return assembleLoop(payload, phase, remainingFixes, nextActions, gate, progress);
}

/**
 * Attach loop. initiate is true only when MCP tools can close this job
 * via remainingFixes + verify_task.
 */
export function withHarnessLoop<T>(
  result: T,
  phase: "run" | "verify" = "run",
  opts?: { baseline?: unknown; progress?: LoopProgress }
): T {
  if (!result || typeof result !== "object") return result;
  const root = result as Record<string, unknown>;

  if (phase === "verify") {
    const delta = root.delta;
    if (delta && typeof delta === "object") {
      const d = delta as {
        gate?: VerifyGate;
        remainingFixes?: RemainingFix[];
        nextActions?: VerifyNextAction[];
        status?: string;
      };
      const remainingFixes = d.remainingFixes || [];
      const nextActions = d.nextActions || [];
      const gate = d.gate || "unknown";
      const progress =
        opts?.progress ||
        advanceLoopProgress({
          baseline: opts?.baseline,
          remainingFixes,
          gate,
          deltaStatus: d.status,
        });
      root.loop = assembleLoop(
        root,
        "verify",
        remainingFixes,
        nextActions,
        gate,
        progress
      );
      return result;
    }
  }

  root.loop = buildHarnessLoopFromReport(root, phase);
  return result;
}

export function shapeAgentResult(
  result: unknown,
  mode: ResponseMode,
  phase: "run" | "verify" = "run"
): unknown {
  return withHarnessLoop(applyResponseMode(result, mode), phase);
}
