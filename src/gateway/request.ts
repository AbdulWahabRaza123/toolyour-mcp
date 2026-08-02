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

const JWT_RE =
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

/**
 * Normalize common MCP input aliases before gateway invoke
 * (e.g. pasted text containing a JWT → token for jwtDecoder).
 */
export function normalizeStepInput(
  operationId: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  if (operationId === "jwtDecoder" || operationId === "jwtSignatureVerifier") {
    if (typeof input.token === "string" && input.token.trim()) return input;
    if (typeof input.jwt === "string" && input.jwt.trim()) {
      return { ...input, token: input.jwt.trim() };
    }
    const blob =
      (typeof input.text === "string" && input.text) ||
      (typeof input.content === "string" && input.content) ||
      "";
    const match = blob.match(JWT_RE);
    if (match?.[0]) return { ...input, token: match[0] };
  }
  if (operationId === "secretLeakScanner" || operationId === "piiScrub") {
    if (typeof input.text === "string" && input.text.trim()) return input;
    if (typeof input.token === "string" && input.token.trim()) {
      return { ...input, text: input.token.trim() };
    }
  }
  return input;
}
