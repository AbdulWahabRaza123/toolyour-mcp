import { randomUUID } from "crypto";
import { validateApiKey } from "../auth/session";
import { invokeGatewayRoute } from "../gateway/client";
import { buildGatewayInvokePayload } from "../gateway/request";
import { shapeResponseForLlm } from "../summarize/registry";
import type { McpToolRoute } from "../contracts";
import type { Logger } from "../observability/logger";

export interface InvokeOperationContext {
  apiKey: string;
  mcpSessionId: string;
  logger: Logger;
}

export async function invokeOperation(
  ctx: InvokeOperationContext,
  route: McpToolRoute,
  operationId: string,
  input: Record<string, unknown>,
  requestId?: string
) {
  const reqId = requestId || randomUUID();
  const session = await validateApiKey(
    ctx.apiKey,
    route.validatePaths[0] || operationId,
    route.backend,
    ctx.logger
  );

  const payload = buildGatewayInvokePayload(route, input);

  const res = await invokeGatewayRoute(route, {
    apiKey: ctx.apiKey,
    sessionToken: session.sessionToken,
    requestId: reqId,
    mcpSessionId: ctx.mcpSessionId,
    operationId,
    body: payload.body,
    formFields: payload.formFields,
    query: payload.query,
    logger: ctx.logger,
  });

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
