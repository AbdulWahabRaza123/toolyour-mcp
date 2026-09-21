/**
 * MCP HTTP discovery documents (SEP drafts).
 * - GET /.well-known/mcp              → SEP-1960 manifest
 * - GET /.well-known/mcp/server-card.json → SEP-1649 server card
 * - GET /.well-known/mcp.json         → early-draft alias (endpoint pointer)
 *
 * Keep in sync with toolbox/lib/mcp-discovery.ts (same facts).
 */
import { constants } from "../config";

export const MCP_PUBLIC_ENDPOINT = "https://api.toolyour.com/mcp";
export const MCP_SITE_URL = "https://www.toolyour.com";
export const MCP_SETUP_URL = `${MCP_SITE_URL}/developers/mcp`;
export const MCP_DOCS_URL = `${MCP_SITE_URL}/developers/docs/mcp-quickstart`;
export const MCP_PROTOCOL_VERSION = "2025-06-18";

const META_TOOLS = [
  {
    name: "plan_task",
    description:
      "Free planning pass: ranked playbook/workflow plan + heuristic credit estimate (not a bill; tools cost 1–10). Does not execute. Next: run_playbook or solve_task, then verify_task.",
  },
  {
    name: "recall_context",
    description:
      "Free Feature Memory recall before rebuilding similar work. Prefer before plan_task when continuing a known domain/repo.",
  },
  {
    name: "solve_task",
    description:
      "Run a job from a plain-language goal. Workflow runs attach verification.evidence + profileId. Then verify_task with this result as baseline.",
  },
  {
    name: "run_playbook",
    description:
      "Execute a skill playbook (ship-gate, SEO, security). Returns verification.evidence + loop.remainingFixes; then verify_task.",
  },
  {
    name: "verify_task",
    description:
      "Close the loop: requires a usable baseline jobReport. Read loop.gate; apply rank-1 loop.nextActions (full list: remainingFixes). Stops on loop.stop (max_rounds|same_findings) or loop.initiate false. Optional async:true; poll get_run.",
  },
  {
    name: "capture_feature",
    description:
      "Free manual Feature Memory capture/refine (title, requirements, supersedes). Auto-capture also runs on loop.gate=pass.",
  },
  {
    name: "list_feature_memory",
    description: "Free list of your Feature Memory records.",
  },
  {
    name: "compare_feature_memory",
    description: "Free compare of Feature Memory records / patterns.",
  },
  {
    name: "publish_feature_pattern",
    description: "Free publish of a Feature Memory pattern to the community catalog.",
  },
  {
    name: "unpublish_feature_pattern",
    description: "Free unpublish of a community Feature Memory pattern you own.",
  },
  {
    name: "delete_feature",
    description: "Free delete of a Feature Memory record you own.",
  },
  {
    name: "list_community_patterns",
    description: "Free browse of published community Feature Memory patterns.",
  },
  {
    name: "list_skills",
    description:
      "List playbooks. Prefer run_playbook immediately for ship-gate, seo-site-audit, web-security-audit.",
  },
  {
    name: "get_run",
    description:
      "Poll async solve_task/run_playbook/run_workflow/verify_task by runId. Read resultStatus — run status completed only means finished.",
  },
  {
    name: "load_skill",
    description: "Load a skill playbook by id (prefer run_playbook to execute).",
  },
  {
    name: "run_workflow",
    description: "Run a named multi-step MCP job/workflow by id. Prefer run_playbook or solve_task.",
  },
  {
    name: "discover_tools",
    description:
      "Advanced catalog search. Prefer plan_task → run_playbook / solve_task for jobs. Use only for a specific operationId.",
  },
  {
    name: "list_categories",
    description: "List tool category families to narrow discover_tools.",
  },
  {
    name: "get_tool_schema",
    description: "Fetch input schema for an operationId before invoke_tool (advanced).",
  },
  {
    name: "invoke_tool",
    description:
      "Advanced: execute one API-backed tool by operationId. Not the default path for ship/SEO/security jobs.",
  },
  {
    name: "fetch_payload",
    description:
      "Fetch full truncated payload by dataRefId (free in-process TTL store).",
  },
  {
    name: "job_start",
    description:
      "Completion-loop: start a frozen task (task-1 … task-5). Do not use for SEO, URLs, or ship-gate.",
  },
  {
    name: "job_status",
    description:
      "Completion-loop status for an existing jobId. Do not mix with plan_task on the same jobId.",
  },
  {
    name: "check_submit",
    description:
      "Completion-loop: host runner only (`npx toolyour-check-run`). Do not invent HMAC pass/fail payloads.",
  },
  {
    name: "job_cancel",
    description: "Completion-loop: cancel an open frozen job.",
  },
  {
    name: "job_declare_action",
    description:
      "Declare a HIGH or CRITICAL host action for a frozen job. Not an approve-all.",
  },
  {
    name: "job_approve",
    description:
      "Human-only scoped approval for one declared actionId. No approve-all.",
  },
] as const;

/** SEP-1649-style server card */
export function buildServerCard() {
  return {
    $schema: "https://modelcontextprotocol.io/schemas/server-card.json",
    version: "1.0",
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: constants.serverName,
      title: "ToolYour MCP Server",
      version: constants.serverVersion,
    },
    description:
      "Remote MCP server for AI agents: plan → run playbook/solve → verify until pass. Ship-gate, SEO audits, and security audits on the same X-Api-Key and monthly credits as REST.",
    homepage: MCP_SETUP_URL,
    websiteUrl: MCP_SITE_URL,
    documentation: MCP_DOCS_URL,
    transport: {
      type: "sse",
      endpoint: MCP_PUBLIC_ENDPOINT,
      messagesPath: "/mcp/messages",
    },
    transports: [
      {
        type: "sse",
        endpoint: MCP_PUBLIC_ENDPOINT,
        messagesPath: "/mcp/messages",
        note: "GET /mcp — SSE for Cursor and similar clients",
      },
      {
        type: "streamable-http",
        endpoint: MCP_PUBLIC_ENDPOINT,
        note: "POST /mcp — Streamable HTTP initialize (Smithery and MCP spec clients). GET /mcp remains SSE.",
      },
      {
        type: "streamable-http",
        endpoint: `${MCP_PUBLIC_ENDPOINT}/http`,
        note: "Explicit Streamable HTTP alias (GET/POST/DELETE /mcp/http)",
      },
    ],
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    },
    authentication: {
      required: true,
      schemes: ["api_key"],
      api_key: {
        header: "X-Api-Key",
        prefix: "ty_",
        description:
          "Same API key as REST (dashboard → API keys). Also accepts Authorization: Bearer ty_…",
      },
    },
    tools: [...META_TOOLS],
    notes: [
      "Two loops — pick exactly one per goal. Skill loop: plan_task → run_playbook or solve_task (both attach verification.evidence on workflow runs) → apply rank-1 loop.nextActions → verify_task. Feature Memory: free recall_context / list_feature_memory / …; auto-record on gate=pass. Completion loop: job_status → `npx toolyour-check-run` (do not invent check_submit HMAC).",
      "invoke_tool is advanced (one-off operationId). Do not use it as the default path for ship-gate, SEO, or security jobs.",
      "Catalog tools are dynamic — only hasApi tools are exposed. Discovery meta-tools are free; execution shares the REST monthly credit quota (1–10 credits per tool). estimatedCredits is always a heuristic.",
      "solve_task / run_playbook responses include verification.evidence, loop.line (gate · rank-1 · credits), loop.remainingFixes (patchType + acceptance), and rank-1 loop.nextActions. Apply rank-1 first; remainingFixes is the full list.",
      "verify_task refuses without a usable baseline jobReport (prior solve_task/run_playbook result, verify_task.after, or raw jobReport).",
      "Loop stop: default maxRounds=5 and sameFindingsLimit=2. When loop.stop is set (max_rounds|same_findings), loop.initiate is false — escalate; do not re-verify.",
      "Large responses may include dataRefId — use fetch_payload (free in-process TTL store, no paid blob).",
      "Optional async:true on solve_task / run_playbook / run_workflow / verify_task returns runId; always poll get_run and read resultStatus (suggest|need_input|verified|error|…). REDIS_URL enables cross-replica. Dashboard mcp.job.finished webhook is optional best-effort and never required for correctness.",
    ],
  };
}

/** SEP-1960-style connection manifest */
export function buildManifest() {
  return {
    mcp_version: "1.0",
    server_version: constants.serverVersion,
    name: constants.serverName,
    title: "ToolYour MCP Server",
    description:
      "Remote MCP harness: plan → run → verify until pass. Same X-Api-Key and monthly credits as REST.",
    endpoints: {
      // Current production transport (SSEServerTransport)
      sse: MCP_PUBLIC_ENDPOINT,
      // Streamable HTTP (SDK-native, free)
      streamableHttp: `${MCP_PUBLIC_ENDPOINT}/http`,
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
      sampling: false,
      roots: false,
    },
    authentication: {
      required: true,
      methods: ["api_key"],
      api_key: {
        header: "X-Api-Key",
        prefix: "ty_",
        alternate_headers: ["Authorization: Bearer ty_…", "Authorization: ApiKey ty_…"],
      },
    },
    security: {
      tls_required: true,
      security_contact: "mailto:support@toolyour.com",
    },
    rate_limits: {
      note: "Shared monthly credit quota with REST (Free: 500 credits/month; tools cost 1–10 credits). Meta discovery tools are free.",
    },
    registration: { dynamic: false },
    documentation: MCP_DOCS_URL,
    homepage: MCP_SETUP_URL,
  };
}

/** Early draft /.well-known/mcp.json pointer (PR #1054 era) */
export function buildLegacyMcpJson() {
  return {
    name: "ToolYour",
    description:
      "Practical tools for AI agents through one remote MCP server (SEO, documents, conversion, text, utilities).",
    icon: `${MCP_SITE_URL}/favicon.ico`,
    endpoint: MCP_PUBLIC_ENDPOINT,
    authentication: {
      type: "api_key",
      header: "X-Api-Key",
      prefix: "ty_",
    },
    documentation: MCP_DOCS_URL,
    homepage: MCP_SETUP_URL,
  };
}

export const DISCOVERY_RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;
