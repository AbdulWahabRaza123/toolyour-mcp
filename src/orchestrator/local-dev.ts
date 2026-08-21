import { MCP_ERROR_CODES } from "../contracts";
import { normalizeGoalText, extractUrlFromText } from "./match-task";

const LOCAL_SIGNALS = [
  "local",
  "localhost",
  "127.0.0.1",
  "my code",
  "this repo",
  "this project",
  "before deploy",
  "not deployed",
  "in development",
  "dev server",
  "my app",
  "this page",
  "my landing page",
  "source code",
  "html file",
  "next.js",
  "vite app",
  "unpublished",
];

const HTML_INPUT_KEYS = ["html", "htmlContent", "pageHtml", "markup", "content"] as const;

export function isLocalDevGoal(goal: string): boolean {
  const g = normalizeGoalText(goal);
  return LOCAL_SIGNALS.some((signal) => g.includes(signal));
}

export function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function extractHtmlFromInput(
  input: Record<string, unknown> | undefined
): string | undefined {
  if (!input) return undefined;

  const nested =
    typeof input.input === "object" && input.input !== null
      ? (input.input as Record<string, unknown>)
      : null;

  const sources = nested ? [input, nested] : [input];
  for (const source of sources) {
    for (const key of HTML_INPUT_KEYS) {
      const value = source[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return undefined;
}

export function resolveUrlFromGoalAndInput(
  goal: string,
  input: Record<string, unknown> | undefined
): string | undefined {
  const data = { ...(input || {}) };
  const nested =
    input && typeof input.input === "object" && input.input !== null
      ? (input.input as Record<string, unknown>)
      : null;
  if (nested) Object.assign(data, nested);

  if (typeof data.url === "string" && data.url.trim()) {
    return data.url.trim();
  }
  return extractUrlFromText(goal);
}

export function isSeoRelatedTask(taskId: string): boolean {
  return (
    taskId.includes("seo") ||
    taskId.includes("content") ||
    taskId === "page-speed"
  );
}

export function localDevGuidance(): {
  message: string;
  options: Array<{ mode: string; description: string }>;
} {
  return {
    message:
      "MCP cannot read localhost or your disk. Read workspace files and pass input.html, input.code, or input.text — or a public/preview https:// URL. Do not pass http://localhost.",
    options: [
      {
        mode: "pass_html",
        description:
          "Read page HTML (index.html, layout output) and call solve_task with input.html — do not ask for a URL",
      },
      {
        mode: "pass_text",
        description:
          "Pass input.text for copy, JSON, env, or secrets checks — no URL needed",
      },
      {
        mode: "pass_code",
        description:
          "Pass input.code from TSX/JSX/HTML/source files — MCP cannot read disk; the host agent must attach contents",
      },
      {
        mode: "preview_url",
        description:
          "If the page is already on a public or preview https:// URL (Vercel/Netlify/Cloudflare preview, staging), pass that URL — not localhost",
      },
      {
        mode: "tunnel_url",
        description:
          "Only if the app is localhost-only: expose via Cloudflare Tunnel or ngrok, then pass that https:// URL",
      },
    ],
  };
}

/**
 * Block live-URL jobs against localhost before any gateway invoke.
 * Partial synthesizers on unreachable hosts look like false passes.
 */
export function buildLocalhostNeedInput(opts: {
  goal: string;
  url: string;
  matchedTask?: {
    id: string;
    title: string;
    type: string;
    target: string;
    score?: number;
  };
  skillId?: string;
}): Record<string, unknown> {
  const guidance = localDevGuidance();
  return {
    status: "need_input" as const,
    code: MCP_ERROR_CODES.LOCAL_PREVIEW_REQUIRED,
    goal: opts.goal,
    url: opts.url,
    ...(opts.matchedTask ? { matchedTask: opts.matchedTask } : {}),
    ...(opts.skillId ? { skillId: opts.skillId } : {}),
    message: guidance.message,
    options: guidance.options,
    hint: "Do not pass http://localhost or 127.0.0.1. Use workspace HTML/text/code, or a public/preview https:// URL.",
    nextActions: [
      "Read page HTML or source from the repo and re-call with input.html / input.text / input.code",
      "Or pass a public/preview https:// URL (not localhost)",
      "Only if needed: expose local via Cloudflare Tunnel / ngrok, then pass that https:// URL",
    ],
    missing: ["url", "html", "text", "code"],
    exampleInput: {
      html: "<!doctype html><html><head><title>…</title></head><body>…</body></html>",
      enhance: false,
    },
  };
}

/** True when goal or input resolves to a localhost URL. */
export function resolveLocalhostUrl(
  goal: string,
  input: Record<string, unknown> | undefined
): string | undefined {
  const url = resolveUrlFromGoalAndInput(goal, input);
  if (url && isLocalhostUrl(url)) return url;
  if (input) {
    for (const key of ["url", "urlA", "urlB", "pageUrl", "siteUrl"] as const) {
      const v = input[key];
      if (typeof v === "string" && isLocalhostUrl(v)) return v.trim();
    }
  }
  return undefined;
}
