import { createHash, randomUUID } from "crypto";

/**
 * Canonical execution context shared by planning, running, verification and
 * memory.  MCP tools remain backwards compatible; this envelope gives the
 * orchestrator one stable identity for a user's intent and its runs.
 */
export type IntentType = "build" | "verify" | "transform" | "observe";

export interface ProjectScope {
  organizationId?: string;
  projectId?: string;
  repository?: string;
  environment?: string;
  targetUrl?: string;
}

export interface WorkIntent {
  intentId: string;
  type: IntentType;
  goal: string;
  domain?: string;
  projectScope: ProjectScope;
  workflowId?: string;
  idempotencyKey: string;
}

export interface RunContext {
  runId: string;
  intent: WorkIntent;
  phase: "planning" | "execution" | "verification" | "complete";
  startedAt: string;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function inferIntentType(goal: string, explicit?: unknown): IntentType {
  if (explicit === "verify" || explicit === "transform" || explicit === "observe" || explicit === "build") {
    return explicit;
  }
  const normalized = goal.toLowerCase();
  if (/\b(verify|validate|regression|check|audit|test)\b/.test(normalized)) return "verify";
  if (/\b(convert|transform|extract|generate|rewrite|summarize)\b/.test(normalized)) return "transform";
  if (/\b(monitor|observe|track|watch)\b/.test(normalized)) return "observe";
  return "build";
}

export function createRunContext(
  goal: string,
  input: Record<string, unknown> = {},
  options: { runId?: string; intentId?: string; phase?: RunContext["phase"] } = {}
): RunContext {
  const runId = options.runId || `run_${cryptoRandomId()}`;
  const execution = (input.execution || {}) as Record<string, unknown>;
  const intentId =
    asNonEmptyString(input.intentId) ||
    asNonEmptyString(execution.intentId) ||
    options.intentId ||
    `intent_${cryptoRandomId()}`;
  const explicitIdempotency = asNonEmptyString(input.idempotencyKey);
  const idempotencyKey = explicitIdempotency || `idem_${stableInputFingerprint(goal, input)}`;
  const project = (input.projectScope || {}) as Record<string, unknown>;
  const projectScope: ProjectScope = {
    organizationId: asNonEmptyString(project.organizationId) || asNonEmptyString(input.organizationId),
    projectId: asNonEmptyString(project.projectId) || asNonEmptyString(input.projectId),
    repository: asNonEmptyString(project.repository) || asNonEmptyString(input.repository),
    environment: asNonEmptyString(project.environment) || asNonEmptyString(input.environment),
    targetUrl: asNonEmptyString(project.targetUrl) || asNonEmptyString(input.url),
  };
  return {
    runId,
    intent: {
      intentId,
      type: inferIntentType(goal, input.intentType),
      goal: goal.trim(),
      domain: asNonEmptyString(input.domain),
      projectScope,
      workflowId: asNonEmptyString(input.workflowId),
      idempotencyKey,
    },
    phase: options.phase || "planning",
    startedAt: new Date().toISOString(),
  };
}

function stableInputFingerprint(goal: string, input: Record<string, unknown>): string {
  const copy = { ...input };
  delete copy.idempotencyKey;
  delete copy.intentId;
  delete copy.execution;
  return createHash("sha256")
    .update(JSON.stringify(copy, Object.keys(copy).sort()))
    .update(":" + goal.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

function cryptoRandomId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
