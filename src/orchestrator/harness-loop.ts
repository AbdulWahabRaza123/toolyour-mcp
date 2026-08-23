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
  /** One-line agent scan: gate · rank-1 · credits · next. */
  line: string;
  round: number;
  maxRounds: number;
  /** Count of API tools used on this run (from jobReport.toolsUsed when present). */
  toolsUsed: number;
  /** Rough estimate — SaaS bills 1–10 credits per tool. */
  estimatedCredits: number;
  note: string;
}

export interface HarnessLoop extends LoopEligibility {
  /** Same as receipt.line — first thing agents should read. */
  line: string;
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

function truncateLabel(text: string, max: number): string {
  const t = String(text || "")
    .trim()
    .replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Single scannable line for agents (gate · rank-1 · credits · what to do).
 */
export function buildReceiptLine(opts: {
  gate: VerifyGate;
  initiate: boolean;
  phase: "run" | "verify";
  nextActions: VerifyNextAction[];
  remainingFixes: RemainingFix[];
  toolsUsed: number;
  estimatedCredits: number;
  stop?: LoopStop;
}): string {
  const parts: string[] = [`gate=${opts.gate}`];

  if (opts.stop) {
    parts.push(`stopped:${opts.stop.code}`);
    parts.push("escalate — do not re-verify");
  } else if (opts.gate === "pass") {
    parts.push("clean");
    parts.push("stop");
  } else if (opts.nextActions[0]?.label) {
    const action = opts.nextActions[0];
    const patch = action.patchType ? ` [${action.patchType}]` : "";
    parts.push(`rank-1: ${truncateLabel(action.label, 80)}${patch}`);
    parts.push(
      opts.initiate ? "apply then verify_task" : "stop — not remediable here"
    );
  } else if (opts.remainingFixes.length > 0) {
    parts.push(`${opts.remainingFixes.length} remaining fix(es)`);
    parts.push(opts.initiate ? "apply then verify_task" : "stop");
  } else if (opts.gate === "fail" || opts.gate === "unknown") {
    parts.push("no remediable fixes");
    parts.push("stop");
  } else {
    parts.push(opts.initiate ? "continue" : "stop");
  }

  if (opts.toolsUsed > 0) {
    parts.push(
      `~${opts.estimatedCredits} credits (${opts.toolsUsed} tool${opts.toolsUsed === 1 ? "" : "s"})`
    );
  } else {
    parts.push("~0 credits");
  }

  if (opts.phase === "verify") {
    parts.push("verify");
  }

  return parts.join(" · ");
}

function countToolsUsed(payload: unknown): number {
  const report = extractJobReport(payload);
  if (report?.toolsUsed?.length) return report.toolsUsed.length;
  if (!payload || typeof payload !== "object") return 0;
  const root = payload as Record<string, unknown>;
  const exec = root.execution;
  if (exec && typeof exec === "object") {
    const steps = (exec as { completedSteps?: unknown }).completedSteps;
    if (Array.isArray(steps)) return steps.length;
  }
  if (Array.isArray(root.completedSteps)) return root.completedSteps.length;
  return 0;
}

function estimateCreditsFromPayload(payload: unknown): number {
  return countToolsUsed(payload) * CREDITS_PER_TOOL_EST;
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
  const toolsUsed = countToolsUsed(payload);
  const effectiveNextActions = decided.initiate ? nextActions : [];
  const line = buildReceiptLine({
    gate,
    initiate: decided.initiate,
    phase,
    nextActions: effectiveNextActions.length ? effectiveNextActions : nextActions,
    remainingFixes,
    toolsUsed,
    estimatedCredits,
    stop: progress.stop,
  });

  return {
    line,
    ...decided,
    phase,
    gate,
    remainingFixes,
    nextActions: effectiveNextActions,
    next: decided.initiate ? LOOP_NEXT_FAIL : decided.reason,
    round: progress.round,
    maxRounds: progress.maxRounds,
    findingFingerprint: progress.findingFingerprint,
    sameFindingsStreak: progress.sameFindingsStreak,
    sameFindingsLimit: progress.sameFindingsLimit,
    ...(progress.stop ? { stop: progress.stop } : {}),
    receipt: {
      line,
      round: progress.round,
      maxRounds: progress.maxRounds,
      toolsUsed,
      estimatedCredits,
      note:
        toolsUsed > 0
          ? `This run used ${toolsUsed} API tool(s). estimatedCredits≈${estimatedCredits} (rough ×${CREDITS_PER_TOOL_EST}); SaaS bills 1–10 credits per tool on the shared REST+MCP quota. Credits buy evidence + re-checks — apply rank-1, then verify_task.`
          : "No API tools counted on this payload. estimatedCredits is rough when tools run (1–10 credits each on the shared REST+MCP quota).",
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
