import { MCP_ERROR_CODES } from "../contracts";
import type { RegistryLoader } from "../registry/loader";
import type { ContentAdapterDef } from "./content-adapters";
import {
  loadContentAdapters,
  findAdapterForTask,
  findAdapterByGoal,
} from "./content-adapters";
import {
  extractContentBundle,
  hasDirectContent,
  shouldEnhanceWithBackendTools,
} from "./content-input";
import {
  isLocalDevGoal,
  isLocalhostUrl,
  localDevGuidance,
  resolveUrlFromGoalAndInput,
} from "./local-dev";
import { analyzeLocalHtml, localSeoToJobReport } from "./local-seo";
import type { JobReport } from "../jobs/types";
import { finalizeJobReport } from "../jobs/utils";
import {
  extractHeadlineTextFromHtml,
  extractLinksFromHtml,
  extractTextFromCode,
  looksLikeHtml,
  resolveWorkingText,
} from "./local-content";
import { invokeOperation, type InvokeOperationContext } from "./invoke-operation";

export interface ContentBridgeTask {
  id: string;
  title: string;
  type: string;
  target: string;
  requiredInput?: string[];
}

export interface ContentBridgeResult {
  status: "completed" | "need_input";
  goal: string;
  code?: string;
  matchedTask?: ContentBridgeTask & { score?: number };
  adapterId?: string;
  message?: string;
  options?: Array<{ mode: string; description: string }>;
  hint?: Record<string, string>;
  missing?: string[];
  jobReport?: JobReport;
  execution: {
    mode: "content-bridge";
    billed: boolean;
    local: unknown[];
    backend?: Array<{
      operationId: string;
      result: unknown;
      httpStatus: number;
    }>;
    note?: string;
    jobReport?: JobReport;
  };
}

function resolveHtml(bundle: ReturnType<typeof extractContentBundle>): string | undefined {
  if (bundle.html) return bundle.html;
  if (bundle.code && looksLikeHtml(bundle.code)) return bundle.code;
  return undefined;
}

function buildToolPayload(
  operationId: string,
  text: string,
  headline?: string
): Record<string, unknown> | null {
  switch (operationId) {
    case "headlineRestructurer":
      return { text: headline || text.slice(0, 500) };
    case "snippetMaker":
      if (text.length < 50) return null;
      return { text: text.slice(0, 10000) };
    case "jargonBuster":
    case "piiScrub":
    case "expenseCategorizer":
      if (!text.trim()) return null;
      return { text: text.slice(0, 100000) };
    case "aiTextAi":
      if (!text.trim()) return null;
      return {
        prompt: `Improve the following content for clarity and usefulness:\n\n${text.slice(0, 12000)}`,
      };
    default:
      if (!text.trim()) return null;
      return { text: text.slice(0, 100000) };
  }
}

async function runTextPipeline(
  adapter: ContentAdapterDef,
  bundle: ReturnType<typeof extractContentBundle>,
  input: Record<string, unknown> | undefined,
  ctx: InvokeOperationContext,
  registry: RegistryLoader
) {
  if (!shouldEnhanceWithBackendTools(input) || !adapter.textPipeline?.length) {
    return [];
  }

  const workingText = resolveWorkingText(bundle);
  const headline = bundle.html
    ? extractHeadlineTextFromHtml(bundle.html)
    : undefined;
  const results: Array<{
    operationId: string;
    result: unknown;
    httpStatus: number;
  }> = [];

  for (const operationId of adapter.textPipeline) {
    const route = registry.getRoute(operationId);
    if (!route) continue;

    const payload = buildToolPayload(
      operationId,
      workingText || extractTextFromCode(bundle.code || "") || "",
      headline
    );
    if (!payload) continue;

    try {
      const invoked = await invokeOperation(ctx, route, operationId, payload);
      results.push({
        operationId,
        result: invoked.shaped,
        httpStatus: invoked.status,
      });
    } catch {
      // pipeline steps are best-effort
    }
  }

  return results;
}

function runLocalHandlers(
  adapter: ContentAdapterDef,
  bundle: ReturnType<typeof extractContentBundle>,
  url?: string
): unknown[] {
  const local: unknown[] = [];
  const html = resolveHtml(bundle);
  const handlers = adapter.localHandlers || [];

  for (const handler of handlers) {
    if (handler === "html-seo-audit" && html) {
      local.push(
        analyzeLocalHtml(html, {
          baseUrl: url,
          sourceHint: bundle.sourceHint,
        })
      );
    }
    if (handler === "html-link-extract" && html) {
      local.push(extractLinksFromHtml(html, url));
    }
  }

  return local;
}

function buildNeedInput(
  goal: string,
  task: ContentBridgeTask | undefined,
  score: number | undefined,
  adapterId?: string
): ContentBridgeResult {
  const guidance = localDevGuidance();
  return {
    status: "need_input",
    goal,
    code: MCP_ERROR_CODES.LOCAL_PREVIEW_REQUIRED,
    adapterId,
    matchedTask: task ? { ...task, score } : undefined,
    message: guidance.message,
    options: guidance.options,
    hint: {
      pass_html:
        "Pass input.html from a rendered page or input.code from a source file in the repo.",
      pass_text:
        "Pass input.text for copy-focused tools (headlines, jargon, snippets, PII scrub).",
      pass_code:
        "Pass input.code with TSX/JSX/HTML source — MCP extracts text and routes to the right tools.",
      preview_url:
        "Or pass a public/preview https:// URL. MCP cannot fetch http://localhost.",
    },
    execution: {
      mode: "content-bridge",
      billed: false,
      local: [],
      note: "URL-based tools cannot reach localhost. Provide html, text, or code instead.",
    },
  };
}

export async function tryContentBridge(
  goal: string,
  input: Record<string, unknown> | undefined,
  task: ContentBridgeTask | undefined,
  score: number | undefined,
  ctx: InvokeOperationContext & { registry: RegistryLoader }
): Promise<ContentBridgeResult | null> {
  const adapters = loadContentAdapters();
  const adapter = task
    ? findAdapterForTask(goal, task, adapters)
    : findAdapterByGoal(goal, adapters);

  if (!adapter) return null;

  const bundle = extractContentBundle(input);
  const url = resolveUrlFromGoalAndInput(goal, input);
  const localGoal = isLocalDevGoal(goal);
  const localhost = url ? isLocalhostUrl(url) : false;
  const hasContent = hasDirectContent(bundle);

  const urlOnlyTool =
    task?.type === "workflow" ||
    Boolean(adapter.urlOperationIds?.includes(task?.target || ""));

  if (url && !localhost && !localGoal && !hasContent) {
    return null;
  }

  if ((localhost || localGoal || urlOnlyTool) && !hasContent) {
    if (localhost || localGoal) {
      return buildNeedInput(goal, task, score, adapter.id);
    }
  }

  if (!hasContent) return null;

  const html = resolveHtml(bundle);
  if (adapter.inputKinds && !adapterAcceptsBundle(adapter, bundle, html)) {
    return buildNeedInput(goal, task, score, adapter.id);
  }

  const local = runLocalHandlers(adapter, bundle, url);
  const backend = await runTextPipeline(adapter, bundle, input, ctx, ctx.registry);

  const seoLocal = local.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { mode?: string }).mode === "local-html-audit"
  ) as import("./local-seo").LocalSeoReport | undefined;

  const jobReport = seoLocal
    ? finalizeJobReport(
        localSeoToJobReport(seoLocal, {
          jobId: task?.id || "local-html-seo",
          goal,
        })
      )
    : undefined;

  return {
    status: "completed",
    goal,
    adapterId: adapter.id,
    matchedTask: task ? { ...task, score } : undefined,
    jobReport,
    execution: {
      mode: "content-bridge",
      billed: backend.length > 0,
      local,
      backend: backend.length > 0 ? backend : undefined,
      jobReport,
      note:
        backend.length > 0
          ? "MCP ran local analysis (free) plus text-based API tools from your html/text/code."
          : "MCP ran local analysis from your html/text/code without a deployed URL.",
    },
  };
}

function adapterAcceptsBundle(
  adapter: ContentAdapterDef,
  bundle: ReturnType<typeof extractContentBundle>,
  html?: string
): boolean {
  const kinds = adapter.inputKinds || ["html", "text", "code"];
  if (kinds.includes("html") && html) return true;
  if (kinds.includes("text") && bundle.text) return true;
  if (kinds.includes("code") && bundle.code) return true;
  if (kinds.includes("html") && bundle.code && looksLikeHtml(bundle.code)) return true;
  if (kinds.includes("text") && bundle.html) return true;
  if (kinds.includes("code") && bundle.text) return true;
  return false;
}
