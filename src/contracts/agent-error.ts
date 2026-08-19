import type { McpErrorBody } from "./types";
import { MCP_ERROR_CODES, mcpError } from "./errors";

/**
 * Agent-facing error: always include code + message; prefer hint + nextActions
 * so harnesses can retry, ask the user, or switch tools without guessing.
 */
export function agentError(
  code: string,
  message: string,
  extra?: Partial<McpErrorBody>
): McpErrorBody {
  return mcpError(code, message, extra);
}

function quotaType(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  const nested =
    o.error && typeof o.error === "object"
      ? (o.error as Record<string, unknown>)
      : null;
  return String(o.type || nested?.type || "").toLowerCase();
}

function retryAfterSeconds(data: unknown, message: string): number | undefined {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const nested =
      o.error && typeof o.error === "object"
        ? (o.error as Record<string, unknown>)
        : null;
    const n = o.retryAfter ?? nested?.retryAfter ?? o.retryAfterSec ?? nested?.retryAfterSec;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const m = /try again in (\d+) seconds/i.exec(message);
  if (m) return Number(m[1]);
  return undefined;
}

function bodyMessage(data: unknown, text: string): string {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const nested =
      o.error && typeof o.error === "object"
        ? (o.error as Record<string, unknown>)
        : null;
    const msg =
      o.message ||
      o.reason ||
      nested?.message ||
      nested?.reason ||
      (typeof o.error === "string" ? o.error : null);
    if (msg != null && String(msg).trim()) return String(msg).slice(0, 400);
  }
  return (text || "Request failed").slice(0, 400);
}

/** Map upstream HTTP failures into stable MCP error codes agents can branch on. */
export function normalizeHttpError(
  status: number,
  data: unknown,
  text: string
): McpErrorBody {
  const message = bodyMessage(data, text);
  const lower = message.toLowerCase();

  if (status === 401) {
    return agentError(MCP_ERROR_CODES.UNAUTHORIZED, message || "Unauthorized", {
      hint: "Create or rotate a ty_ key in the dashboard → API keys, then reconnect MCP.",
      retryable: false,
      nextActions: [
        "Set a valid X-Api-Key (ty_…)",
        "If the key was rotated, update Cursor/Claude MCP config",
      ],
    });
  }

  if (
    status === 403 ||
    /not allowed|blocked for api|tool not available/i.test(lower)
  ) {
    return agentError(
      MCP_ERROR_CODES.TOOL_NOT_ALLOWED,
      message || "Tool not allowed for this API key",
      {
        hint: "This key may use allowedTools, or the tool is website-only (hasApi false). Use a full key or pick an API-backed operationId via discover_tools.",
        retryable: false,
        nextActions: [
          "Call discover_tools for an API-backed alternative",
          "Or create a key without an allowedTools allowlist",
        ],
      }
    );
  }

  if (status === 429 || /quota|rate limit|monthly limit|credits/i.test(lower)) {
    const kind = quotaType(data);
    const waitSec = retryAfterSeconds(data, message);
    if (
      kind === "rate_limit" ||
      (!kind && /rate limit|try again in \d+ seconds/i.test(lower))
    ) {
      const sec = waitSec || 48;
      return agentError(
        MCP_ERROR_CODES.RATE_LIMITED,
        message || "Rate limit exceeded",
        {
          hint: "Per-minute burst limit on Free — wait, then retry the same step. This is not monthly credits.",
          retryable: true,
          retryAfterMs: sec * 1000,
          nextActions: [
            `Wait ${sec}s then retry the same tool or playbook step`,
            "Monthly credits are unchanged — this is a per-minute burst cap",
          ],
        }
      );
    }
    return agentError(
      MCP_ERROR_CODES.QUOTA_EXCEEDED,
      message || "Monthly quota exceeded",
      {
        hint: "Execution shares REST monthly credits. plan_task, discover_tools, get_run, and suggestions stay free.",
        retryable: true,
        nextActions: [
          "Wait for the monthly credit reset or upgrade the plan in the dashboard",
          "Use plan_task to estimate cost before re-running",
        ],
      }
    );
  }

  if (status >= 500) {
    return agentError(
      MCP_ERROR_CODES.GATEWAY_ERROR,
      message || `Upstream error (${status})`,
      {
        hint: "Transient upstream failure — retry once; if it persists, check gateway health.",
        retryable: true,
        nextActions: ["Retry the same call once after a short delay"],
      }
    );
  }

  return agentError(
    MCP_ERROR_CODES.INVALID_INPUT,
    message || `Request failed (${status})`,
    {
      hint: "Fix the input (required fields / schema) and retry. Use get_tool_schema for the operationId.",
      retryable: false,
      nextActions: [
        "Call get_tool_schema(operationId) and supply missing fields",
        "Or rephrase via solve_task with input.url / input.html",
      ],
    }
  );
}

/** Normalize thrown errors (auth, circuit, network) for tool responses. */
export function formatCaughtError(e: unknown): McpErrorBody {
  const err = e as Error & {
    code?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  };
  const message = err?.message || String(e);
  const code = err?.code || "";

  if (code === MCP_ERROR_CODES.CIRCUIT_OPEN || code === "circuit_open") {
    return agentError(MCP_ERROR_CODES.CIRCUIT_OPEN, message, {
      hint: "Backend temporarily open after repeated failures — wait then retry.",
      retryable: true,
      retryAfterMs: err.retryAfterMs,
      nextActions: [
        `Wait ${Math.ceil((err.retryAfterMs || 5000) / 1000)}s then retry`,
      ],
    });
  }

  if (
    code === MCP_ERROR_CODES.UNAUTHORIZED ||
    code === "unauthorized" ||
    /unauthorized|invalid or revoked|missing api key/i.test(message)
  ) {
    return agentError(MCP_ERROR_CODES.UNAUTHORIZED, message, {
      hint: "Create or rotate a ty_ key in the dashboard → API keys.",
      retryable: false,
      nextActions: ["Update MCP config with a valid X-Api-Key"],
    });
  }

  if (code === MCP_ERROR_CODES.WORKFLOW_NOT_FOUND || code === "workflow_not_found") {
    return agentError(MCP_ERROR_CODES.WORKFLOW_NOT_FOUND, message, {
      hint: "Unknown workflowId — use list_skills / run_playbook or solve_task with a plain-language goal.",
      retryable: false,
    });
  }

  return agentError(code || MCP_ERROR_CODES.GATEWAY_ERROR, message, {
    hint: "Unexpected failure — retry once; if it persists, try plan_task then a clearer solve_task goal.",
    retryable: err.retryable === true,
    retryAfterMs: err.retryAfterMs,
    nextActions: ["Retry once", "Or call plan_task to pick another path"],
  });
}
