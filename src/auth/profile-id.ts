import { createHash } from "crypto";

/** Stable, non-reversible MCP profile identifier derived from ToolYour's user ID. */
export function createToolYourProfileId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new Error("ToolYour user ID is required");

  const digest = createHash("sha256")
    .update(`toolyour-mcp-profile:v1:${normalized}`)
    .digest("hex")
    .slice(0, 32);
  return `typrof_${digest}`;
}
