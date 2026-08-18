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
      if (v === undefined || v === null) continue;
      formFields[k] =
        Array.isArray(v) || (typeof v === "object" && !(v instanceof Date))
          ? JSON.stringify(v)
          : String(v);
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
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/;

const URL_BATCH_CONVERTORS = new Set([
  "convertToJpg",
  "convertToPng",
  "convertToWebp",
  "convertToSvg",
  "convertToAvif",
  "convertToHeic",
  "convertToHeif",
  "convertToTiff",
  "convertToGif",
  "compressImage",
  "compressSvg",
  "convertToGrayscale",
  "imageToPdf",
  "folderToZip",
]);

function parseUrlList(raw: unknown): string[] | null {
  if (raw == null || raw === "") return null;
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) return null;
        items = parsed;
      } catch {
        return null;
      }
    } else {
      items = trimmed.split(/[\n,]+/);
    }
  } else {
    return null;
  }
  const urls = items
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^https?:\/\//i.test(item));
  return urls.length ? urls : null;
}

function compressImageSrcs(node: unknown, depth = 0): string[] {
  if (!node || depth > 8) return [];
  if (Array.isArray(node)) {
    return node.flatMap((item) => compressImageSrcs(item, depth + 1));
  }
  if (typeof node !== "object") return [];
  const rec = node as Record<string, unknown>;
  const out: string[] = [];
  if (Array.isArray(rec.compressImages)) {
    for (const row of rec.compressImages) {
      if (row && typeof row === "object") {
        const src = String((row as { src?: unknown }).src || "").trim();
        if (/^https?:\/\//i.test(src)) out.push(src);
      }
    }
  }
  for (const value of Object.values(rec)) {
    if (value && typeof value === "object") {
      out.push(...compressImageSrcs(value, depth + 1));
    }
  }
  return [...new Set(out)];
}

function nestedDownloadUrl(input: Record<string, unknown>): string | undefined {
  const direct = input.downloadUrl;
  if (typeof direct === "string" && /^https?:\/\//i.test(direct)) return direct;
  const data = input.data;
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (typeof rec.downloadUrl === "string") return rec.downloadUrl;
    const result = rec.result;
    if (result && typeof result === "object") {
      const url = (result as { downloadUrl?: unknown }).downloadUrl;
      if (typeof url === "string") return url;
    }
  }
  return undefined;
}

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
  if (URL_BATCH_CONVERTORS.has(operationId)) {
    const explicit = parseUrlList(input.urls);
    const urls = explicit || compressImageSrcs(input);
    if (urls?.length) {
      const fromPriorStep =
        !explicit &&
        (input.status === 200 ||
          (input.data != null && typeof input.data === "object") ||
          (input.report != null && typeof input.report === "object"));
      if (fromPriorStep) return { urls };
      return { ...input, urls };
    }
  }
  if (operationId === "zipExtract") {
    const urls = parseUrlList(input.urls);
    if (urls?.length) return { ...input, urls };
    const downloadUrl = nestedDownloadUrl(input);
    if (downloadUrl) return { urls: [downloadUrl] };
  }
  return input;
}
