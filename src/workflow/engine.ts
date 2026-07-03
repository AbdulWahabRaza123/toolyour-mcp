import fs from "fs";
import { getEnv } from "../config";
import type { McpWorkflowDef } from "../contracts";
import { invokeGatewayRoute } from "../gateway/client";
import { buildGatewayInvokePayload, extractUrlFromPayload } from "../gateway/request";
import { validateApiKey } from "../auth/session";
import { RegistryLoader } from "../registry/loader";
import { shapeResponseForLlm } from "../summarize/registry";
import type { Logger } from "../observability/logger";
import { randomUUID } from "crypto";

export function loadWorkflows(): McpWorkflowDef[] {
  const env = getEnv();
  if (!fs.existsSync(env.workflowsPath)) return [];
  const raw = JSON.parse(fs.readFileSync(env.workflowsPath, "utf8"));
  return Array.isArray(raw.workflows) ? raw.workflows : [];
}

export interface WorkflowRunContext {
  apiKey: string;
  mcpSessionId?: string;
  registry: RegistryLoader;
  logger: Logger;
}

export async function runWorkflow(
  workflowId: string,
  input: Record<string, unknown>,
  ctx: WorkflowRunContext
) {
  const workflows = loadWorkflows();
  const wf = workflows.find((w) => w.id === workflowId);
  if (!wf) {
    throw Object.assign(new Error("Workflow not found"), {
      code: "workflow_not_found",
    });
  }

  const completedSteps: string[] = [];
  const stepResults: Record<string, unknown> = {};
  let lastOutput: unknown = input;

  for (const step of wf.steps) {
    const route = ctx.registry.getRoute(step.operationId);
    if (!route) {
      return {
        status: "partial",
        workflowId,
        completedSteps,
        failedStep: step.id,
        error: { code: "tool_not_api_backed", operationId: step.operationId },
        partialResult: stepResults,
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

      const payload = buildGatewayInvokePayload(route, stepInput);

      const res = await invokeGatewayRoute(route, {
        apiKey: ctx.apiKey,
        sessionToken: session.sessionToken,
        requestId: randomUUID(),
        mcpSessionId: ctx.mcpSessionId,
        operationId: step.operationId,
        body: payload.body,
        formFields: payload.formFields,
        query: payload.query,
        logger: ctx.logger,
      });

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
        return {
          status: "partial",
          workflowId,
          completedSteps,
          failedStep: step.id,
          error: shaped,
          partialResult: stepResults,
        };
      }
    } catch (e) {
      return {
        status: "partial",
        workflowId,
        completedSteps,
        failedStep: step.id,
        error: e instanceof Error ? e.message : String(e),
        partialResult: stepResults,
      };
    }
  }

  return {
    status: "completed",
    workflowId,
    completedSteps,
    result: lastOutput,
  };
}
