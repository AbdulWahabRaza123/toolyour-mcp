import type { McpToolRoute } from "../contracts";

export interface GatewayInvokePayload {
  body?: unknown;
  formFields?: Record<string, string>;
  query?: Record<string, string>;
}

/** Map MCP tool input to gateway body, query, or multipart fields. */
export function buildGatewayInvokePayload(
  route: McpToolRoute,
  input: Record<string, unknown>
): GatewayInvokePayload {
  const method = route.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "DELETE") {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && v !== null) query[k] = String(v);
    }
    return { query };
  }

  if (route.jsonBody) {
    return { body: input };
  }

  if (route.multipart) {
    const formFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && v !== null) formFields[k] = String(v);
    }
    return { formFields };
  }

  return { body: input };
}

/** Pull a URL from workflow input or a prior step's shaped response. */
export function extractUrlFromPayload(
  payload: Record<string, unknown>
): string | undefined {
  if (typeof payload.url === "string" && payload.url.trim()) {
    return payload.url.trim();
  }

  const data = payload.data as Record<string, unknown> | undefined;
  if (data && typeof data.url === "string" && data.url.trim()) {
    return data.url.trim();
  }

  const preview = data?.preview;
  if (typeof preview === "string") {
    const match = preview.match(/"url"\s*:\s*"(https?:[^"]+)"/);
    if (match?.[1]) return match[1];
  }

  return undefined;
}
