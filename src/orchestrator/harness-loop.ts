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

export const LOOP_NEXT_FAIL =
  "Apply loop.remainingFixes in the host repo (editor/git). Then call verify_task with this entire result as baseline. Do not invoke_tool for the same job.";

export interface HarnessLoop extends LoopEligibility {
  phase: "run" | "verify";
  gate: VerifyGate;
  remainingFixes: RemainingFix[];
  nextActions: VerifyNextAction[];
  next: string;
}

function assembleLoop(
  payload: unknown,
  phase: "run" | "verify",
  remainingFixes: RemainingFix[],
  nextActions: VerifyNextAction[],
  gate: VerifyGate
): HarnessLoop {
  const decided = decideRunLoop({
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

  return {
    ...decided,
    phase,
    gate,
    remainingFixes,
    nextActions: decided.initiate ? nextActions : [],
    next: decided.initiate ? LOOP_NEXT_FAIL : decided.reason,
  };
}

export function buildHarnessLoopFromReport(
  payload: unknown,
  phase: "run" | "verify"
): HarnessLoop {
  const report = extractJobReport(payload);
  const remainingFixes = buildRemainingFixes(report);
  const nextActions = buildNextActions(remainingFixes);
  const gate = computeVerifyGate(report);
  return assembleLoop(payload, phase, remainingFixes, nextActions, gate);
}

/**
 * Attach loop. initiate is true only when MCP tools can close this job
 * via remainingFixes + verify_task.
 */
export function withHarnessLoop<T>(result: T, phase: "run" | "verify" = "run"): T {
  if (!result || typeof result !== "object") return result;
  const root = result as Record<string, unknown>;

  if (phase === "verify") {
    const delta = root.delta;
    if (delta && typeof delta === "object") {
      const d = delta as {
        gate?: VerifyGate;
        remainingFixes?: RemainingFix[];
        nextActions?: VerifyNextAction[];
      };
      const remainingFixes = d.remainingFixes || [];
      const nextActions = d.nextActions || [];
      const gate = d.gate || "unknown";
      root.loop = assembleLoop(root, "verify", remainingFixes, nextActions, gate);
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
