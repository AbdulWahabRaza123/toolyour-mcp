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
      "Free planning pass: ranked playbook/workflow plan + estimated credits. Does not execute. Next: run_playbook or solve_task, then verify_task.",
  },
  {
    name: "solve_task",
    description:
      "Run a job from a plain-language goal. Returns jobReport plus loop.remainingFixes and loop.gate. Then verify_task with this result as baseline.",
  },
  {
    name: "run_playbook",
    description:
      "Execute a skill playbook (ship-gate, SEO, security). Returns loop.remainingFixes; then verify_task.",
  },
  {
    name: "verify_task",
    description:
      "Close the loop: requires a usable baseline jobReport. Read loop.gate; apply rank-1 loop.nextActions (full list: remainingFixes). Stops on loop.stop (max_rounds|same_findings) or loop.initiate false. Optional async:true; poll get_run.",
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
      "Completion-loop: host runner only (toolyour-check-run). Do not invent results.",
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
      "Two loops — pick exactly one per goal. Skill loop: plan_task → run_playbook or solve_task → apply rank-1 loop.nextActions (full list: remainingFixes) → verify_task. Completion loop: job_status → host toolyour-check-run; do not invent check_submit.",
      "invoke_tool is advanced (one-off operationId). Do not use it as the default path for ship-gate, SEO, or security jobs.",
      "Catalog tools are dynamic — only hasApi tools are exposed. Discovery meta-tools are free; execution shares the REST monthly credit quota.",
      "solve_task / run_playbook responses include loop.remainingFixes (patchType + acceptance) even on the first run. loop.nextActions is rank-1 only — apply that item first; remainingFixes is the full list.",
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
