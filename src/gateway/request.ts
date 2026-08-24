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

const DEVELOPER_PASTE_OPS = new Set([
  "jsonFormatter",
  "jsonValidator",
  "jsonToZod",
  "jsonToTypescript",
  "jsonToGoStruct",
  "jsonToPython",
  "jsonToYaml",
  "yamlToJson",
  "xmlFormatter",
]);

const PASTE_FIELD_KEYS = [
  "json",
  "text",
  "yaml",
  "xml",
  "code",
  "html",
  "css",
  "sql",
] as const;

function hasDeveloperPasteFields(input: Record<string, unknown>): boolean {
  for (const key of PASTE_FIELD_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

/**
 * Pull pasteable content from a prior shaped gateway step
 * (e.g. yamlToJson → result.json for jsonFormatter).
 */
export function extractDeveloperPasteFromPrior(
  prior: Record<string, unknown>
): Record<string, unknown> | null {
  if (hasDeveloperPasteFields(prior)) return null;
  const data = prior.data;
  if (!data || typeof data !== "object") return null;
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.json === "string" && r.json.trim()) {
    return { json: r.json, text: r.json };
  }
  if (typeof r.formatted === "string" && r.formatted.trim()) {
    return { text: r.formatted, json: r.formatted, xml: r.formatted };
  }
  if (typeof r.yaml === "string" && r.yaml.trim()) {
    return { yaml: r.yaml, text: r.yaml };
  }
  if (typeof r.xml === "string" && r.xml.trim()) {
    return { xml: r.xml, text: r.xml };
  }
  return null;
}

/**
 * Developer paste tools need workflow text/json after validate-style steps
 * that return status shells without the original payload.
 */
export function resolveDeveloperPasteStepInput(
  operationId: string,
  workflowInput: Record<string, unknown>,
  stepInput: Record<string, unknown>
): Record<string, unknown> {
  if (!DEVELOPER_PASTE_OPS.has(operationId)) return stepInput;
  if (hasDeveloperPasteFields(stepInput)) return stepInput;

  const fromPrior = extractDeveloperPasteFromPrior(stepInput);
  if (fromPrior) return { ...workflowInput, ...fromPrior };

  if (hasDeveloperPasteFields(workflowInput)) {
    return { ...workflowInput };
  }

  return stepInput;
}

const MARKETING_CARRY_OPS = new Set([
  "utmBuilder",
  "adsUtmBuilder",
  "utmParser",
  "utmBulkBuilder",
  "utmNamingConventionChecker",
  "adsCopyCounter",
  "googleAdsRsaPreview",
  "emailSubjectLineTester",
  "emailSpamWordChecker",
  "roasCalculator",
  "cpcCalculator",
  "ctrCalculator",
  "cpaCalculator",
  "cacCalculator",
]);

function isShapedPriorStep(input: Record<string, unknown>): boolean {
  return (
    input.status === 200 ||
    input.status === 400 ||
    (input.data != null && typeof input.data === "object") ||
    typeof input.operationId === "string"
  );
}

function extractUrlFromMarketingPrior(
  prior: Record<string, unknown>
): string | undefined {
  const data = prior.data;
  if (!data || typeof data !== "object") return undefined;
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return undefined;
  const url = (result as Record<string, unknown>).url;
  return typeof url === "string" && url.trim() ? url.trim() : undefined;
}

/**
 * Marketing playbook steps lose baseUrl / utm_* / platform after step 1
 * because lastOutput is a shaped gateway shell. Carry workflow fields and
 * pipe utmBuilder result.url into utmParser.
 */
export function resolveMarketingStepInput(
  operationId: string,
  workflowInput: Record<string, unknown>,
  stepInput: Record<string, unknown>
): Record<string, unknown> {
  if (!MARKETING_CARRY_OPS.has(operationId)) return stepInput;

  let next = stepInput;
  if (isShapedPriorStep(stepInput)) {
    next = { ...workflowInput };
    const builtUrl = extractUrlFromMarketingPrior(stepInput);
    if (builtUrl && (operationId === "utmParser" || operationId === "utmNamingConventionChecker")) {
      next = { ...next, url: builtUrl, link: builtUrl };
    }
  }

  // Alias short keys agents often pass (also accepted by API utmParamsFromBody).
  if (typeof next.source === "string" && !next.utm_source) {
    next = { ...next, utm_source: next.source };
  }
  if (typeof next.medium === "string" && !next.utm_medium) {
    next = { ...next, utm_medium: next.medium };
  }
  if (typeof next.campaign === "string" && !next.utm_campaign) {
    next = { ...next, utm_campaign: next.campaign };
  }
  if (typeof next.network === "string" && !next.platform) {
    next = { ...next, platform: next.network };
  }

  // adsUtmBuilder requires platform — default google when building from UTM brief.
  if (
    operationId === "adsUtmBuilder" &&
    (typeof next.platform !== "string" || !String(next.platform).trim())
  ) {
    next = { ...next, platform: "google" };
  }

  return next;
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
    const priorResult =
      input.data && typeof input.data === "object"
        ? (input.data as Record<string, unknown>).result
        : undefined;
    if (priorResult && typeof priorResult === "object") {
      const tok = (priorResult as Record<string, unknown>).token;
      if (typeof tok === "string" && tok.trim()) {
        return { ...input, token: tok.trim() };
      }
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
