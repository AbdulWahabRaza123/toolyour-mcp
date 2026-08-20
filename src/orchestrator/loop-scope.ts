import { loadWorkflows } from "../workflow/engine";
import type { RemainingFix } from "./job-report";

const GENERIC_INVESTIGATE =
  "Investigate and remediate this finding, then re-run verify_task.";

const LOOP_OUT_OF_SCOPE =
  "Out of ToolYour MCP scope. Do not start the harness loop (no plan → run → verify).";

const LOOP_ONE_SHOT =
  "This is a one-shot catalog job. Use the output and stop — do not start verify_task.";

const LOOP_NOT_REMEDIABLE =
  "MCP diagnosed the issue but has no remediable fix from its tools. Do not start verify_task.";

const LOOP_NEED_INPUT =
  "Missing required input. Do not start verify_task until the job can run.";

const LOOP_GATE_PASS =
  "Gate pass. Stop unless the user asked to re-verify after more changes.";

const LOOP_INCOMPLETE =
  "Run incomplete (partial or error). Fix the input or URL and re-run — do not treat this as ship-ready.";

export interface LoopEligibility {
  /** Start / continue plan → run → verify until pass. */
  initiate: boolean;
  /** Goal maps to a ToolYour catalog job (including one-shot converters). */
  inScope: boolean;
  reason: string;
}

const eligibilityCache = new Map<string, boolean>();

/** Workflows with a synthesizer produce a jobReport the verify loop can close. */
export function workflowClosesWithVerify(workflowId: string | undefined): boolean {
  const id = String(workflowId || "").trim();
  if (!id) return false;
  const cached = eligibilityCache.get(id);
  if (cached !== undefined) return cached;
  const wf = loadWorkflows().find((w) => w.id === id);
  const ok = Boolean(wf?.synthesizer);
  eligibilityCache.set(id, ok);
  return ok;
}

export function remainingFixesAreActionable(fixes: RemainingFix[]): boolean {
  return fixes.some((f) =>
    (f.actions || []).some((a) => {
      const t = String(a || "").trim();
      return t.length > 0 && t !== GENERIC_INVESTIGATE;
    })
  );
}

export function extractWorkflowId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  if (typeof root.workflowId === "string" && root.workflowId) return root.workflowId;
  const exec = root.execution;
  if (exec && typeof exec === "object") {
    const id = (exec as { workflowId?: string }).workflowId;
    if (id) return id;
  }
  const jr = root.jobReport;
  if (jr && typeof jr === "object") {
    const id = (jr as { workflowId?: string }).workflowId;
    if (id) return id;
  }
  if (root.after !== undefined) return extractWorkflowId(root.after);
  if (root.result !== undefined) return extractWorkflowId(root.result);
  return undefined;
}

export function decidePlanLoop(opts: {
  confidence: "high" | "medium" | "low" | "none";
  recommendedKind?: "workflow" | "tool" | "local" | "playbook";
  workflowId?: string;
}): LoopEligibility {
  if (opts.confidence === "none" || opts.confidence === "low") {
    return {
      initiate: false,
      inScope: false,
      reason:
        opts.confidence === "none"
          ? LOOP_OUT_OF_SCOPE
          : "Low confidence match. Clarify the goal before starting the harness loop.",
    };
  }
  const closable = workflowClosesWithVerify(opts.workflowId);
  if (closable) {
    return {
      initiate: true,
      inScope: true,
      reason:
        "In-scope closable job (ship/SEO/security/audit). After the run, continue verify_task only if that result has loop.initiate true.",
    };
  }
  if (opts.recommendedKind === "tool" || opts.recommendedKind === "workflow" || opts.recommendedKind === "playbook") {
    return {
      initiate: false,
      inScope: true,
      reason: LOOP_ONE_SHOT,
    };
  }
  if (opts.recommendedKind === "local") {
    return {
      initiate: true,
      inScope: true,
      reason:
        "Local content job is in scope. After the run, continue verify_task only if that result has loop.initiate true.",
    };
  }
  return {
    initiate: false,
    inScope: false,
    reason: LOOP_OUT_OF_SCOPE,
  };
}

export function decideRunLoop(opts: {
  status?: string;
  workflowId?: string;
  hasJobReport: boolean;
  gate: "pass" | "fail" | "unknown";
  remainingFixes: RemainingFix[];
}): LoopEligibility {
  const status = String(opts.status || "");
  if (status === "suggest" || status === "need_workflow") {
    return { initiate: false, inScope: false, reason: LOOP_OUT_OF_SCOPE };
  }
  if (status === "partial" || status === "error") {
    return {
      initiate: false,
      inScope:
        opts.hasJobReport ||
        workflowClosesWithVerify(opts.workflowId) ||
        Boolean(opts.workflowId),
      reason: LOOP_INCOMPLETE,
    };
  }
  if (status === "need_input" || status === "accepted") {
    return {
      initiate: false,
      inScope: workflowClosesWithVerify(opts.workflowId),
      reason: LOOP_NEED_INPUT,
    };
  }
  if (!opts.hasJobReport) {
    return {
      initiate: false,
      inScope: Boolean(opts.workflowId),
      reason: LOOP_ONE_SHOT,
    };
  }
  if (opts.gate === "pass") {
    return { initiate: false, inScope: true, reason: LOOP_GATE_PASS };
  }
  if (!remainingFixesAreActionable(opts.remainingFixes)) {
    return {
      initiate: false,
      inScope: true,
      reason: LOOP_NOT_REMEDIABLE,
    };
  }
  if (!workflowClosesWithVerify(opts.workflowId) && opts.workflowId) {
    return {
      initiate: false,
      inScope: true,
      reason: LOOP_ONE_SHOT,
    };
  }
  return {
    initiate: true,
    inScope: true,
    reason:
      "MCP tools can re-score this job after the host applies remainingFixes. Call verify_task with this result as baseline.",
  };
}

export const LOOP_COPY = {
  outOfScope: LOOP_OUT_OF_SCOPE,
  oneShot: LOOP_ONE_SHOT,
  notRemediable: LOOP_NOT_REMEDIABLE,
  needInput: LOOP_NEED_INPUT,
  gatePass: LOOP_GATE_PASS,
  incomplete: LOOP_INCOMPLETE,
} as const;
