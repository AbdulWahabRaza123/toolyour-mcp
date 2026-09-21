import type { Logger } from "../observability/logger";
import type { RunContext } from "../contracts";

export type ExecutionOperation =
  | "plan_task"
  | "solve_task"
  | "run_playbook"
  | "run_workflow"
  | "verify_task";

const FREE_RESULT_STATUSES = new Set([
  "plan",
  "suggest",
  "need_input",
  "error",
]);

/** Add stable orchestration identity without wiping workflow/tool execution payloads. */
export function attachExecutionContext(result: unknown, context: RunContext): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const root = result as Record<string, unknown>;
  const priorExec =
    root.execution && typeof root.execution === "object" && !Array.isArray(root.execution)
      ? (root.execution as Record<string, unknown>)
      : {};
  return {
    ...root,
    execution: {
      ...priorExec,
      runId: context.runId,
      intentId: context.intent.intentId,
      intentType: context.intent.type,
      idempotencyKey: context.intent.idempotencyKey,
      projectScope: context.intent.projectScope,
    },
    /**
     * Credits are reserved/settled on each gateway tool invoke (Node/Python APIs),
     * not again here — executeIntent must not double-bill.
     */
    billing: {
      settledBy: "gateway_per_tool",
      metaTool: optsBillingFree(context),
    },
  };
}

function optsBillingFree(context: RunContext): boolean {
  // plan_task and memory tools never hit gateway; run/verify may.
  return context.phase === "planning";
}

/**
 * Canonical execution boundary for all skill-loop operations.
 * Credit settlement stays on the gateway tool path; this facade owns correlation,
 * the additive execution envelope, and future audit/evidence hooks.
 */
export async function executeIntent<T>(opts: {
  operation: ExecutionOperation;
  context: RunContext;
  logger: Logger;
  sessionId?: string;
  run: () => Promise<T>;
}): Promise<unknown> {
  const startedAt = Date.now();
  opts.logger.info("intent_started", {
    operation: opts.operation,
    runId: opts.context.runId,
    intentId: opts.context.intent.intentId,
    intentType: opts.context.intent.type,
    idempotencyKey: opts.context.intent.idempotencyKey,
    projectScope: opts.context.intent.projectScope,
    mcpSessionId: opts.sessionId,
    transport: "mcp",
  });
  try {
    const result = await opts.run();
    const shaped = attachExecutionContext(result, opts.context);
    if (shaped && typeof shaped === "object" && !Array.isArray(shaped)) {
      const root = shaped as Record<string, unknown>;
      const billing = (root.billing || {}) as Record<string, unknown>;
      const status = String(root.status || "");
      const metaTool = opts.operation === "plan_task";
      const charged = !metaTool && !FREE_RESULT_STATUSES.has(status);
      root.billing = {
        ...billing,
        settledBy: "gateway_per_tool",
        metaTool,
        operation: opts.operation,
        charged,
        ...(charged
          ? {
              note: "Credits settle only when gateway API tools run (1–10 each). This envelope does not double-bill.",
            }
          : {
              chargedReason: metaTool
                ? "plan_task"
                : status || "no_gateway_settlement",
              note: "No gateway settlement for this result — planning/suggest/need_input paths are free; only API tool invokes bill credits.",
            }),
      };
    }
    opts.logger.info("intent_completed", {
      operation: opts.operation,
      runId: opts.context.runId,
      intentId: opts.context.intent.intentId,
      durationMs: Date.now() - startedAt,
      status:
        shaped && typeof shaped === "object"
          ? (shaped as { status?: string }).status
          : undefined,
      transport: "mcp",
    });
    return shaped;
  } catch (error) {
    opts.logger.warn("intent_failed", {
      operation: opts.operation,
      runId: opts.context.runId,
      intentId: opts.context.intent.intentId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      transport: "mcp",
    });
    throw error;
  }
}
