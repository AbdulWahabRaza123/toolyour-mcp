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
      "Free planning pass: ranked workflow/tool/playbook plan + estimated credits. Does not execute.",
  },
  {
    name: "solve_task",
    description:
      "Primary entry: plain-language goal; fuzzy matching + confidence gating. Default compact jobReport. Ambiguous goals return status suggest.",
  },
  {
    name: "run_playbook",
    description:
      "Execute a skill's mapped workflow (or local content ship) in one call.",
  },
  {
    name: "verify_task",
    description:
      "Re-run a goal and return score/finding deltas vs a baseline jobReport.",
  },
  {
    name: "discover_tools",
    description:
      "Search API-backed tools by keyword. Free catalog browse. Typical flow: discover_tools → get_tool_schema → invoke_tool.",
  },
  {
    name: "list_categories",
    description: "List tool category families to narrow discover_tools.",
  },
  {
    name: "get_tool_schema",
    description: "Fetch input schema for an operationId before invoke_tool.",
  },
  {
    name: "invoke_tool",
    description:
      "Execute an API-backed tool by operationId. Bills the same monthly quota as REST.",
  },
  {
    name: "fetch_payload",
    description:
      "Fetch full truncated payload by dataRefId (free in-process TTL store).",
  },
  {
    name: "get_run",
    description:
      "Poll an async solve_task/run_playbook/run_workflow by runId (free in-process TTL).",
  },
  {
    name: "list_skills",
    description: "List agent skill playbooks available on this server.",
  },
  {
    name: "load_skill",
    description: "Load a skill playbook by id (prefer run_playbook to execute).",
  },
  {
    name: "run_workflow",
    description: "Run a named multi-step MCP job/workflow by id.",
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
      "Remote MCP server for SEO, documents, conversion, text, and related API-backed tools. Same X-Api-Key and monthly quota as the ToolYour REST API.",
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
        note: "Legacy SSE — widely supported (Cursor, etc.)",
      },
      {
        type: "streamable-http",
        endpoint: `${MCP_PUBLIC_ENDPOINT}/http`,
        note: "MCP Streamable HTTP — free SDK transport; use when the client supports it",
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
      "Catalog tools (converters, SEO, documents, etc.) are dynamic — use discover_tools; only hasApi tools are exposed.",
      "Discovery meta-tools are free; tool/workflow execution shares the REST monthly quota.",
      "solve_task is the primary entry with fuzzy matching and confidence gating; ambiguous goals return ranked suggestions. Use plan_task (free) before execute; run_playbook for skills; verify_task for deltas. Default solve_task responses are compact.",
      "Large responses may include dataRefId — use fetch_payload (free in-process TTL store, no paid blob).",
      "Optional async:true on solve_task / run_playbook / run_workflow returns runId; poll get_run or configure a job-finished webhook in the dashboard.",
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
      "Remote MCP for API-backed ToolYour tools. Auth via X-Api-Key (same key/quota as REST).",
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
      note: "Shared monthly quota with REST (Free: 500 requests/month). Meta discovery tools are free.",
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
