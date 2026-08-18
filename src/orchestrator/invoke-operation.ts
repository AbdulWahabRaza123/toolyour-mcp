import { randomUUID } from "crypto";
import { invalidateApiKeyCache, validateApiKey } from "../auth/session";
import { invokeGatewayRoute } from "../gateway/client";
import { buildGatewayInvokePayload, normalizeStepInput } from "../gateway/request";
import { shapeResponseForLlm } from "../summarize/registry";
import { MCP_ERROR_CODES, type McpToolRoute } from "../contracts";
import type { Logger } from "../observability/logger";
import type { RegistryLoader } from "../registry/loader";
import { validateInputAgainstSchema } from "./schema-validate";

export interface InvokeOperationContext {
  apiKey: string;
  mcpSessionId: string;
  logger: Logger;
  registry?: RegistryLoader;
  mcpTool?: string;
  skillId?: string;
  workflowId?: string;
}

export async function invokeOperation(
  ctx: InvokeOperationContext,
  route: McpToolRoute,
  operationId: string,
  input: Record<string, unknown>,
  requestId?: string
) {
  const reqId = requestId || randomUUID();
  const normalized = normalizeStepInput(operationId, input);

  if (ctx.registry) {
    const schema = ctx.registry.getSchema(operationId);
    if (schema) {
      const validation = validateInputAgainstSchema(schema, normalized);
      if (!validation.ok) {
        return {
          requestId: reqId,
          status: 400,
          shaped: {
            status: 400,
            error: {
              code: MCP_ERROR_CODES.INVALID_INPUT,
              message: "Input failed schema validation",
              missing: validation.missing,
              issues: validation.issues,
              hint: "Call get_tool_schema(operationId), fix required fields, then invoke_tool again.",
              nextActions: [
                "get_tool_schema for this operationId",
                "Re-invoke with missing fields filled",
              ],
              retryable: false,
            },
          },
          isError: true,
        };
      }
    }
  }

  const session = await validateApiKey(
    ctx.apiKey,
    route.validatePaths[0] || operationId,
    route.backend,
    ctx.logger
  );

  const payload = buildGatewayInvokePayload(route, normalized);

  const res = await invokeGatewayRoute(route, {
    apiKey: ctx.apiKey,
    sessionToken: session.sessionToken,
    requestId: reqId,
    mcpSessionId: ctx.mcpSessionId,
    operationId,
    mcpTool: ctx.mcpTool || "invoke_tool",
    skillId: ctx.skillId,
    workflowId: ctx.workflowId,
    body: payload.body,
    formFields: payload.formFields,
    query: payload.query,
    logger: ctx.logger,
  });

  if (res.status === 401) {
    invalidateApiKeyCache(ctx.apiKey, route.backend);
  }

  const shaped = shapeResponseForLlm(
    operationId,
    res.status,
    res.data,
    res.text
  );

  return {
    requestId: reqId,
    status: res.status,
    shaped,
    isError: res.status < 200 || res.status >= 300,
  };
}
