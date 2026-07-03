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
      "Live URL tools cannot reach your machine from the cloud. Use one of these MCP-only options:",
    options: [
      {
        mode: "pass_html",
        description:
          "Agent reads page HTML (index.html, layout output) and calls solve_task with input.html",
      },
      {
        mode: "pass_text",
        description:
          "Pass input.text for copy tools (headlines, jargon, snippets, PII scrub) — no URL needed",
      },
      {
        mode: "pass_code",
        description:
          "Pass input.code from TSX/JSX/HTML source files — MCP extracts text and runs matching tools",
      },
      {
        mode: "tunnel_url",
        description:
          "Expose local dev via Cloudflare Tunnel or ngrok, then pass the public preview URL",
      },
      {
        mode: "deployed_url",
        description:
          "Use staging/production URL for full audit including page speed",
      },
    ],
  };
}
