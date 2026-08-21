import type { McpErrorBody } from "./types";

export const MCP_ERROR_CODES = {
  TOOL_NOT_API_BACKED: "tool_not_api_backed",
  TOOL_NOT_ALLOWED: "tool_not_allowed",
  UNAUTHORIZED: "unauthorized",
  INVALID_INPUT: "invalid_input",
  NEED_INPUT: "need_input",
  AMBIGUOUS_GOAL: "ambiguous_goal",
  QUOTA_EXCEEDED: "quota_exceeded",
  RATE_LIMITED: "rate_limited",
  GATEWAY_ERROR: "gateway_error",
  CIRCUIT_OPEN: "circuit_open",
  WORKFLOW_NOT_FOUND: "workflow_not_found",
  WORKFLOW_PARTIAL: "workflow_partial",
  SKILL_NOT_FOUND: "skill_not_found",
  REGISTRY_UNAVAILABLE: "registry_unavailable",
  LOCAL_PREVIEW_REQUIRED: "local_preview_required",
  NEED_BASELINE: "need_baseline",
} as const;

export function mcpError(
  code: string,
  message: string,
  extra?: Partial<McpErrorBody>
): McpErrorBody {
  return { code, message, ...extra };
}
