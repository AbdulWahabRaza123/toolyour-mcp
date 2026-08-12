import { defsCache } from "../registry/defs-cache";
import type { McpWorkflowDef } from "../contracts";
import { invokeGatewayRoute } from "../gateway/client";
import { buildGatewayInvokePayload, extractUrlFromPayload, normalizeStepInput } from "../gateway/request";
import { invalidateApiKeyCache, validateApiKey } from "../auth/session";
import { RegistryLoader } from "../registry/loader";
import { shapeResponseForLlm } from "../summarize/registry";
import type { Logger } from "../observability/logger";
import { randomUUID } from "crypto";
import { synthesizeJobReport } from "../jobs/synthesize";
import type { WorkflowStepMeta } from "../jobs/types";
import { incr } from "../observability/counters";

export function loadWorkflows(): McpWorkflowDef[] {
  return defsCache.getWorkflows();
}

export interface WorkflowRunContext {
  apiKey: string;
  mcpSessionId?: string;
  registry: RegistryLoader;
  logger: Logger;
  mcpTool?: string;
  skillId?: string;
  workflowId?: string;
}

export interface WorkflowRunResult {
  status: "completed" | "partial";
  workflowId: string;
  completedSteps: string[];
  failedStep?: string;
  error?: unknown;
  stepErrors?: Record<string, unknown>;
  steps: Record<string, unknown>;
  /** Last step shaped output (legacy) */
  result: unknown;
  jobReport?: ReturnType<typeof synthesizeJobReport>;
  partialResult?: Record<string, unknown>;
}

export async function runWorkflow(
  workflowId: string,
  input: Record<string, unknown>,
  ctx: WorkflowRunContext
): Promise<WorkflowRunResult> {
  const wf = defsCache.getWorkflow(workflowId);
  if (!wf) {
    throw Object.assign(new Error("Workflow not found"), {
      code: "workflow_not_found",
    });
  }

  const completedSteps: string[] = [];
  const stepResults: Record<string, unknown> = {};
  const stepErrors: Record<string, unknown> = {};
  const stepMeta: WorkflowStepMeta[] = [];
  let lastOutput: unknown = input;
  let hardFail: {
    failedStep: string;
    error: unknown;
  } | null = null;

  for (const step of wf.steps) {
    const route = ctx.registry.getRoute(step.operationId);
    stepMeta.push({ id: step.id, operationId: step.operationId });
    if (!route) {
      const err = { code: "tool_not_api_backed", operationId: step.operationId };
      if (step.continueOnError) {
        stepErrors[step.id] = err;
        continue;
      }
      incr("workflowPartial");
      const jobReport = partialJobReport(wf, input, stepMeta, stepResults);
      return {
        status: "partial",
        workflowId,
        completedSteps,
        failedStep: step.id,
        error: err,
        stepErrors,
        steps: stepResults,
        result: lastOutput,
        partialResult: stepResults,
        jobReport: jobReport || undefined,
      };
    }

    try {
      const session = await validateApiKey(
        ctx.apiKey,
        route.validatePaths[0] || route.operationId,
        route.backend,
        ctx.logger
      );

      let stepInput =
        step.inputFrom && stepResults[step.inputFrom]
          ? (stepResults[step.inputFrom] as Record<string, unknown>)
          : (lastOutput as Record<string, unknown>);

      if (
        route.method.toUpperCase() === "GET" &&
        typeof stepInput.url !== "string"
      ) {
        const url =
          extractUrlFromPayload(stepInput) ?? extractUrlFromPayload(input);
        if (url) stepInput = { ...stepInput, url };
      }

      // Multi-URL steps (seoChangeDiff): prefer urlA/urlB from workflow input
      if (
        typeof input.urlA === "string" &&
        typeof input.urlB === "string" &&
        !stepInput.urlA
      ) {
        stepInput = {
          ...stepInput,
          urlA: input.urlA,
          urlB: input.urlB,
        };
      }

      // Prefer original workflow input fields for text/token tools after prior steps
      if (
        (step.operationId === "jwtDecoder" ||
          step.operationId === "secretLeakScanner" ||
          step.operationId === "jwtSignatureVerifier") &&
        stepInput !== input
      ) {
        stepInput = { ...input, ...stepInput };
      }

      stepInput = normalizeStepInput(step.operationId, stepInput);

      const payload = buildGatewayInvokePayload(route, stepInput);

      const res = await invokeGatewayRoute(route, {
        apiKey: ctx.apiKey,
        sessionToken: session.sessionToken,
        requestId: randomUUID(),
        mcpSessionId: ctx.mcpSessionId,
        operationId: step.operationId,
        mcpTool: ctx.mcpTool,
        skillId: ctx.skillId,
        workflowId: ctx.workflowId || workflowId,
        body: payload.body,
        formFields: payload.formFields,
        query: payload.query,
        logger: ctx.logger,
      });

      if (res.status === 401) {
        invalidateApiKeyCache(ctx.apiKey, route.backend);
      }

      const shaped = shapeResponseForLlm(
        step.operationId,
        res.status,
        res.data,
        res.text
      );
      stepResults[step.id] = shaped;
      completedSteps.push(step.id);
      lastOutput = shaped;

      if (res.status < 200 || res.status >= 300) {
        if (step.continueOnError) {
          stepErrors[step.id] = shaped;
          continue;
        }
        hardFail = { failedStep: step.id, error: shaped };
        break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        e &&
        typeof e === "object" &&
        (e as { code?: string }).code === "unauthorized"
      ) {
        invalidateApiKeyCache(ctx.apiKey);
      }
      if (step.continueOnError) {
        stepErrors[step.id] = msg;
        continue;
      }
      hardFail = { failedStep: step.id, error: msg };
      break;
    }
  }

  if (hardFail) {
    incr("workflowPartial");
    const jobReport = partialJobReport(wf, input, stepMeta, stepResults);
    return {
      status: "partial",
      workflowId,
      completedSteps,
      failedStep: hardFail.failedStep,
      error: hardFail.error,
      stepErrors: Object.keys(stepErrors).length ? stepErrors : undefined,
      steps: stepResults,
      result: lastOutput,
      partialResult: stepResults,
      jobReport: jobReport || undefined,
    };
  }

  const jobReport = wf.synthesizer
    ? synthesizeJobReport({
        synthesizerId: wf.synthesizer,
        workflowId: wf.id,
        jobId: wf.id,
        input,
        steps: stepMeta,
        stepResults,
      })
    : null;

  incr(Object.keys(stepErrors).length ? "workflowPartial" : "workflowCompleted");

  return {
    status: Object.keys(stepErrors).length ? "partial" : "completed",
    workflowId,
    completedSteps,
    stepErrors: Object.keys(stepErrors).length ? stepErrors : undefined,
    steps: stepResults,
    result: jobReport || lastOutput,
    jobReport: jobReport || undefined,
  };
}

function partialJobReport(
  wf: McpWorkflowDef,
  input: Record<string, unknown>,
  stepMeta: WorkflowStepMeta[],
  stepResults: Record<string, unknown>
) {
  if (!wf.synthesizer || Object.keys(stepResults).length === 0) return null;
  try {
    return synthesizeJobReport({
      synthesizerId: wf.synthesizer,
      workflowId: wf.id,
      jobId: wf.id,
      input,
      steps: stepMeta,
      stepResults,
    });
  } catch {
    return null;
  }
}
