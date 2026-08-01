/**
 * Explicit non-goals for the agent scale phase (documented so agents don't invent them).
 * Visual agent-builder UI and org/tenant multi-tenancy stay deferred until playbooks +
 * agent-labeled keys prove insufficient.
 */
export const AGENT_SCALE_NON_GOALS = [
  "visual-agent-builder-ui",
  "org-multi-tenant-billing",
  "paid-crux-embedding-router",
  "replacing-cursor-claude-harness",
] as const;
