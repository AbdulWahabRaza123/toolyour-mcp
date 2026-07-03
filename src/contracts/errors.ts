import type { McpErrorBody } from "./types";

export const MCP_ERROR_CODES = {
  TOOL_NOT_API_BACKED: "tool_not_api_backed",
  UNAUTHORIZED: "unauthorized",
  INVALID_INPUT: "invalid_input",
  GATEWAY_ERROR: "gateway_error",
  CIRCUIT_OPEN: "circuit_open",
  WORKFLOW_NOT_FOUND: "workflow_not_found",
  WORKFLOW_PARTIAL: "workflow_partial",
  SKILL_NOT_FOUND: "skill_not_found",
  REGISTRY_UNAVAILABLE: "registry_unavailable",
  LOCAL_PREVIEW_REQUIRED: "local_preview_required",
} as const;

export function mcpError(
  code: string,
  message: string,
  extra?: Partial<McpErrorBody>
): McpErrorBody {
  return { code, message, ...extra };
}
