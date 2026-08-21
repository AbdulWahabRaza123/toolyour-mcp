import type { McpTaskDef } from "../contracts";
import { MCP_ERROR_CODES } from "../contracts";

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

function extractUrlFromText(text: string): string | undefined {
  const match = text.match(URL_RE);
  return match?.[0]?.replace(/[.,;:!?)]+$/, "");
}

function normalizeGoalText(goal: string): string {
  return goal.trim().toLowerCase().replace(/\s+/g, " ");
}

const LIVE_LINK_PHRASES = [
  "this url",
  "this link",
  "live site",
  "live url",
  "preview deploy",
  "preview url",
  "staging url",
  "production url",
  "analyze the link",
  "analyse the link",
  "check the deployed",
  "deployed site",
  "headers on the site",
  "lighthouse",
  "fetch https",
  "crawl https",
  "public url",
  "reachable url",
];

const PAYLOAD_FIRST_PHRASES = [
  "pull request",
  " this pr",
  "this pr ",
  "ship this pr",
  "before merge",
  "changed files",
  "my code",
  "this html",
  "this json",
  "this copy",
  "this yaml",
  "without deploy",
  "not deployed",
  "local files",
  "workspace",
  "source code",
  "format this",
  "validate this json",
  "lint ",
  "from my repo",
  "in the repo",
  "unpublished",
];

const PAYLOAD_KEYS = [
  "text",
  "code",
  "html",
  "json",
  "sql",
  "yaml",
  "css",
  "xml",
  "file",
  "fileContent",
  "source",
  "sourceCode",
  "content",
  "copy",
  "subject",
  "token",
  "jwt",
] as const;

/** URL-required tasks that have a local/payload equivalent. */
export const LOCAL_EQUIVALENT_TASK_ID: Record<string, string> = {
  "seo-audit": "seo-audit-local",
  "fix-verify-seo-audit": "seo-audit-local",
  "full-seo-optimization": "seo-audit-local",
  "technical-seo-audit": "seo-audit-local",
  "fix-verify-technical-seo": "seo-audit-local",
  "structured-data-audit": "seo-audit-local",
  "fix-verify-structured-data": "seo-audit-local",
  "content-quality-audit": "content-improve-local",
  "keyword-opportunity-review": "content-improve-local",
  "social-preview-audit": "content-ship-local",
  "fix-verify-social-preview": "content-ship-local",
  "ship-gate": "pr-code-gate",
  "fix-verify-ship-gate": "pr-code-gate",
  "developer-ship-checklist": "pr-code-gate",
  "landing-conversion-check": "content-ship-local",
  "fix-verify-landing-conversion-check": "content-ship-local",
  "ai-overview-readiness": "seo-audit-local",
  "site-icons-audit": "seo-audit-local",
};

export function explicitLiveUrlIntent(goal: string): boolean {
  if (extractUrlFromText(goal)) return true;
  const g = normalizeGoalText(goal);
  return LIVE_LINK_PHRASES.some((p) => g.includes(p));
}

export function payloadFirstIntent(goal: string): boolean {
  const g = ` ${normalizeGoalText(goal)} `;
  return PAYLOAD_FIRST_PHRASES.some((p) => g.includes(p));
}

function flattenInput(
  input: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!input) return {};
  const nested =
    typeof input.input === "object" && input.input !== null
      ? (input.input as Record<string, unknown>)
      : null;
  return nested ? { ...input, ...nested } : { ...input };
}

export function applyPayloadAliases(
  data: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...data };
  if (typeof next.text === "string" && next.text.trim()) return next;
  for (const key of [
    "code",
    "html",
    "json",
    "sql",
    "yaml",
    "css",
    "xml",
    "source",
    "sourceCode",
    "fileContent",
    "content",
    "copy",
  ]) {
    const value = next[key];
    if (typeof value === "string" && value.trim()) {
      next.text = value.trim();
      break;
    }
  }
  return next;
}

export function hasPayloadInput(
  input: Record<string, unknown> | undefined
): boolean {
  const data = flattenInput(input);
  return PAYLOAD_KEYS.some((key) => {
    const value = data[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function localEquivalentTaskId(taskId: string): string | undefined {
  return LOCAL_EQUIVALENT_TASK_ID[taskId];
}

/** Inverse of local equivalents — use when the user passed a live URL and no payload. */
export const FETCH_EQUIVALENT_TASK_ID: Record<string, string> = {
  "pr-code-gate": "ship-gate",
  "seo-audit-local": "seo-audit",
  "local-page-seo": "seo-audit",
  "content-improve-local": "content-quality-audit",
  "content-ship-local": "seo-audit",
};

export function fetchEquivalentTaskId(taskId: string): string | undefined {
  return FETCH_EQUIVALENT_TASK_ID[taskId];
}

export function hasUrlishInput(
  input: Record<string, unknown> | undefined
): boolean {
  const data = flattenInput(input);
  for (const key of ["url", "baseUrl"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return true;
  }
  return false;
}

export function hasLiveUrlSignal(
  goal: string,
  input?: Record<string, unknown>
): boolean {
  return explicitLiveUrlIntent(goal) || hasUrlishInput(input);
}

export function taskRequiresUrl(task: Pick<McpTaskDef, "requiredInput">): boolean {
  return Boolean(task.requiredInput?.includes("url"));
}

export function payloadNeedInput(params: {
  goal: string;
  matchedTask: {
    id: string;
    title: string;
    type: string;
    target: string;
    score?: number;
  };
  fetchOnly?: boolean;
}) {
  const extra = params.fetchOnly
    ? [
        "PageSpeed, TLS, mixed content, and live headers need a public https:// URL — pass input.url only if the user asked to analyze a live link.",
      ]
    : [];
  return {
    status: "need_input" as const,
    code: MCP_ERROR_CODES.NEED_INPUT,
    goal: params.goal,
    matchedTask: params.matchedTask,
    missing: params.fetchOnly ? ["url"] : ["text", "code", "html"],
    message: params.fetchOnly
      ? "This job fetches a live page. Pass input.url only if the user asked to analyze a deployed or preview link — otherwise pass workspace files for a local check."
      : "Read workspace files and pass their contents (input.html / input.code / input.text). Do not ask for a public URL unless the user asked to analyze a live or preview https:// link. MCP cannot fetch localhost.",
    hint: params.fetchOnly
      ? `Matched "${params.matchedTask.title}" — this tool cannot run on local files. Re-call with input.url, or switch to a payload job (pr-code-gate / seo-audit-local / content-ship).`
      : `Matched "${params.matchedTask.title}" — re-call solve_task with input.text, input.code, or input.html from the repo.`,
    nextActions: [
      "Read the relevant workspace files (or git diff) and pass input.text / input.code / input.html / input.json",
      "Map files with invoke_tool: jsonValidator, jsFormatter, htmlFormatter, cssFormatter, sqlValidator, yamlToJson, secretLeakScanner",
      "Do not invent a URL or scrape GitHub — MCP cannot read the user's disk",
      ...extra,
    ],
    exampleInput: params.fetchOnly
      ? { url: "https://example.com" }
      : {
          text: "Paste file contents or env/config here",
          code: "const x = 1;",
          html: "<!doctype html><html><body>…</body></html>",
        },
  };
}

export function urlNeedInput(params: {
  goal: string;
  matchedTask: {
    id: string;
    title: string;
    type: string;
    target: string;
    score?: number;
  };
  missing: string[];
}) {
  const exampleInput: Record<string, string> = {};
  for (const field of params.missing) {
    if (field === "url") exampleInput.url = "https://example.com";
    else if (field === "html") exampleInput.html = "<html>…</html>";
    else if (field === "text") exampleInput.text = "Paste copy here";
    else exampleInput[field] = `value for ${field}`;
  }
  return {
    status: "need_input" as const,
    code: MCP_ERROR_CODES.NEED_INPUT,
    goal: params.goal,
    matchedTask: params.matchedTask,
    missing: params.missing,
    message: `Live-link analysis needs: ${params.missing.join(", ")}`,
    hint: `Matched "${params.matchedTask.title}" — this job fetches a public page. Re-call with input.url.`,
    nextActions: [
      "Re-call with a reachable https:// URL in input.url (preview, staging, or production)",
      "If the user wanted a local file/PR/HTML check instead, pass workspace contents to pr-code-gate / content-ship — do not invent a URL",
    ],
    exampleInput,
  };
}
