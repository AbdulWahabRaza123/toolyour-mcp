import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { MCP_ERROR_CODES } from "../contracts";
import { constants } from "../config";
import { RegistryLoader, searchTools } from "../registry/loader";
import { loadSkillContent, loadSkills } from "../skills/loader";
import { runWorkflow } from "../workflow/engine";
import { invokeOperation, solveTask } from "../orchestrator/solve-task";
import { payloadStore } from "../payloads/store";
import type { Logger } from "../observability/logger";

export interface McpServerContext {
  apiKey: string;
  mcpSessionId: string;
  registry: RegistryLoader;
  logger: Logger;
}

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

/**
 * Typed wrapper around McpServer.tool to avoid Zod+SDK TS2589 deep instantiation
 * without silencing the whole module via @ts-nocheck.
 */
function registerTool(
  server: McpServer,
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
): void {
  const register = server.tool.bind(server) as (
    n: string,
    d: string,
    s: Record<string, z.ZodTypeAny>,
    h: (args: Record<string, unknown>) => Promise<ToolResult>
  ) => void;
  register(name, description, schema, handler);
}

function textResult(payload: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

export function createToolYourMcpServer(ctx: McpServerContext): McpServer {
  const server = new McpServer({
    name: constants.serverName,
    version: constants.serverVersion,
  });

  registerTool(
    server,
    "solve_task",
    "Primary entry point: describe what the user wants in natural language. Server auto-picks workflow or tool with fuzzy matching and confidence gating, extracts URLs from the goal, and runs it. Ambiguous goals return status suggest with ranked taskSuggestions and toolSuggestions. For local/unpublished work, pass input.html, input.text, or input.code — MCP runs free local analysis and text-based tools without a deployed URL. Set input.enhance=false to skip billed API text tools. Suggestions are free; bills quota only when a backend tool/workflow executes.",
    {
      goal: z
        .string()
        .describe(
          "User intent in plain language, e.g. 'SEO audit for https://example.com'"
        ),
      input: z
        .any()
        .optional()
        .describe(
          "Optional: url, html, text, code, sourceHint (file path), enhance (false to skip billed text tools)"
        ),
    },
    async (args) => {
      const goal = String(args.goal || "");
      const input = (args.input || {}) as Record<string, unknown>;
      const result = await solveTask(goal, input, ctx);
      return textResult(
        result,
        result.status === "error" || result.status === "partial"
      );
    }
  );

  registerTool(
    server,
    "discover_tools",
    "Search 230+ API-backed tools by keyword or intent. Returns compact cards (not full schemas). Use specific queries (e.g. 'docx pdf', 'headline rewrite', 'webp convert'). Call list_categories first to narrow by family, then discover_tools(query, category). Free — not billed. Typical flow: discover_tools → get_tool_schema → invoke_tool.",
    {
      query: z
        .string()
        .describe(
          "Specific search terms matching tool name or purpose, e.g. 'docx to pdf', 'page speed', 'pii scrub'"
        ),
      category: z
        .string()
        .optional()
        .describe(
          "Optional category from list_categories, e.g. 'Documents', 'SEO Tools', 'Convertors'"
        ),
      limit: z.number().int().min(1).max(25).optional(),
    },
    async (args) => {
      const query = String(args.query || "");
      const category =
        typeof args.category === "string" ? args.category : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const manifest = ctx.registry.getManifest();
      const tools = searchTools(manifest, query, category, limit);
      return textResult({ tools, count: tools.length });
    }
  );

  registerTool(
    server,
    "list_categories",
    "List tool category families (Convertors, Documents, SEO Tools, etc.). Use before discover_tools to narrow search — e.g. discover_tools('pdf', category: 'Documents'). Free — not billed.",
    {},
    async () => {
      const categories = ctx.registry.getManifest().categories;
      return textResult({ categories });
    }
  );

  registerTool(
    server,
    "get_tool_schema",
    "Get JSON schema for one API-backed tool by operationId.",
    {
      operationId: z.string(),
    },
    async (args) => {
      const operationId = String(args.operationId || "");
      if (!ctx.registry.hasOperation(operationId)) {
        return textResult(
          {
            error: {
              code: MCP_ERROR_CODES.TOOL_NOT_API_BACKED,
              message: "Tool not available for API / MCP",
            },
          },
          true
        );
      }
      const schema = ctx.registry.getSchema(operationId);
      const route = ctx.registry.getRoute(operationId);
      return textResult({ operationId, route, schema });
    }
  );

  registerTool(
    server,
    "invoke_tool",
    "Invoke an API-backed ToolYour tool. Large outputs return downloadUrl.",
    {
      operationId: z.string(),
      input: z.any().optional(),
      requestId: z.string().optional(),
    },
    async (args) => {
      const operationId = String(args.operationId || "");
      const route = ctx.registry.getRoute(operationId);
      if (!route) {
        return textResult(
          {
            error: {
              code: MCP_ERROR_CODES.TOOL_NOT_API_BACKED,
              message: "Tool not available for API / MCP",
            },
          },
          true
        );
      }

      const started = Date.now();
      const reqId =
        typeof args.requestId === "string" && args.requestId
          ? args.requestId
          : randomUUID();

      try {
        const invoked = await invokeOperation(
          ctx,
          route,
          operationId,
          (args.input || {}) as Record<string, unknown>,
          reqId
        );

        ctx.logger.info("invoke_tool", {
          requestId: reqId,
          mcpSessionId: ctx.mcpSessionId,
          operationId,
          durationMs: Date.now() - started,
          transport: "mcp",
        });

        return textResult(invoked.shaped, invoked.isError);
      } catch (e) {
        const err = e as Error & { code?: string; retryable?: boolean };
        return textResult(
          {
            error: {
              code: err.code || MCP_ERROR_CODES.GATEWAY_ERROR,
              message: err.message,
              retryable: err.retryable,
            },
          },
          true
        );
      }
    }
  );

  registerTool(
    server,
    "list_skills",
    "List curated ToolYour agent skills (playbooks).",
    { category: z.string().optional() },
    async (args) => {
      let skills = loadSkills();
      const category =
        typeof args.category === "string" ? args.category : undefined;
      if (category) {
        skills = skills.filter(
          (s) => s.category.toLowerCase() === category.toLowerCase()
        );
      }
      return textResult({ skills });
    }
  );

  registerTool(
    server,
    "load_skill",
    "Load full skill playbook markdown for a multi-step agent goal.",
    { skillId: z.string() },
    async (args) => {
      const skillId = String(args.skillId || "");
      const content = loadSkillContent(skillId);
      if (!content) {
        return textResult(
          { error: { code: MCP_ERROR_CODES.SKILL_NOT_FOUND, skillId } },
          true
        );
      }
      return {
        content: [{ type: "text", text: content }],
      };
    }
  );

  registerTool(
    server,
    "fetch_payload",
    "Fetch a full truncated tool/workflow payload by dataRefId from a summarized response. Free — in-process TTL store (no paid blob). Returns 404 if expired; re-run the tool then.",
    {
      dataRefId: z
        .string()
        .describe("UUID from summarized response dataRefId field"),
    },
    async (args) => {
      const dataRefId = String(args.dataRefId || "").trim();
      const entry = payloadStore.get(dataRefId);
      if (!entry) {
        return textResult(
          {
            error: {
              code: MCP_ERROR_CODES.INVALID_INPUT,
              message: "Payload not found or expired",
              hint: "dataRef entries expire after a short TTL; re-invoke the tool/workflow.",
            },
          },
          true
        );
      }
      return textResult({
        id: entry.id,
        operationId: entry.operationId,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        originalBytes: entry.bytes,
        data: entry.data,
      });
    }
  );

  registerTool(
    server,
    "run_workflow",
    "Run a server-side multi-step workflow (bills per underlying tool call).",
    {
      workflowId: z.string(),
      input: z.any().optional(),
    },
    async (args) => {
      const workflowId = String(args.workflowId || "");
      const input = (args.input || {}) as Record<string, unknown>;
      const result = await runWorkflow(workflowId, input, {
        apiKey: ctx.apiKey,
        mcpSessionId: ctx.mcpSessionId,
        registry: ctx.registry,
        logger: ctx.logger,
      });
      return textResult(result, result.status === "partial");
    }
  );

  return server;
}
