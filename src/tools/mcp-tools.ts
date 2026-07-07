/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — MCP SDK + Zod triggers TS2589 deep instantiation on tool registrations
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { MCP_ERROR_CODES } from "../contracts";
import { constants } from "../config";
import { RegistryLoader, searchTools } from "../registry/loader";
import { loadSkillContent, loadSkills } from "../skills/loader";
import { runWorkflow } from "../workflow/engine";
import { invokeOperation, solveTask } from "../orchestrator/solve-task";
import type { Logger } from "../observability/logger";

export interface McpServerContext {
  apiKey: string;
  mcpSessionId: string;
  registry: RegistryLoader;
  logger: Logger;
}

export function createToolYourMcpServer(ctx: McpServerContext): McpServer {
  const server = new McpServer({
    name: constants.serverName,
    version: constants.serverVersion,
  });

  server.tool(
    "solve_task",
    "Primary entry point (early phase): describe what the user wants in natural language. Server attempts to auto-pick workflow or tool, extracts URLs from the goal, and runs it. Routing and workflows are improving regularly as tools upgrade and new MCP workflows ship. For production-critical flows, prefer discover_tools → get_tool_schema → invoke_tool. For local/unpublished work, pass input.html, input.text, or input.code from the workspace — MCP runs free local analysis and text-based tools without a deployed URL. Set input.enhance=false to skip billed API text tools. If status is suggest, review toolSuggestions in the response or call discover_tools with a specific query. Suggestions are free; bills quota only when a backend tool/workflow executes.",
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
    async ({ goal, input }) => {
      const result = await solveTask(goal, input || {}, ctx);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        isError: result.status === "error" || result.status === "partial",
      };
    }
  );

  server.tool(
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
    async ({ query, category, limit }) => {
      const manifest = ctx.registry.getManifest();
      const tools = searchTools(manifest, query, category, limit);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ tools, count: tools.length }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_categories",
    "List tool category families (Convertors, Documents, SEO Tools, etc.). Use before discover_tools to narrow search — e.g. discover_tools('pdf', category: 'Documents'). Free — not billed.",
    {},
    async () => {
      const categories = ctx.registry.getManifest().categories;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ categories }, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "get_tool_schema",
    "Get JSON schema for one API-backed tool by operationId.",
    {
      operationId: z.string(),
    },
    async ({ operationId }) => {
      if (!ctx.registry.hasOperation(operationId)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: {
                  code: MCP_ERROR_CODES.TOOL_NOT_API_BACKED,
                  message: "Tool not available for API / MCP",
                },
              }),
            },
          ],
          isError: true,
        };
      }
      const schema = ctx.registry.getSchema(operationId);
      const route = ctx.registry.getRoute(operationId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ operationId, route, schema }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "invoke_tool",
    "Invoke an API-backed ToolYour tool. Large outputs return downloadUrl.",
    {
      operationId: z.string(),
      input: z.any().optional(),
      requestId: z.string().optional(),
    },
    async ({ operationId, input, requestId }) => {
      const route = ctx.registry.getRoute(operationId);
      if (!route) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: {
                  code: MCP_ERROR_CODES.TOOL_NOT_API_BACKED,
                  message: "Tool not available for API / MCP",
                },
              }),
            },
          ],
          isError: true,
        };
      }

      const started = Date.now();
      const reqId = requestId || randomUUID();

      try {
        const invoked = await invokeOperation(
          ctx,
          route,
          operationId,
          (input || {}) as Record<string, unknown>,
          reqId
        );

        ctx.logger.info("invoke_tool", {
          requestId: reqId,
          mcpSessionId: ctx.mcpSessionId,
          operationId,
          durationMs: Date.now() - started,
          transport: "mcp",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(invoked.shaped, null, 2),
            },
          ],
          isError: invoked.isError,
        };
      } catch (e) {
        const err = e as Error & { code?: string; retryable?: boolean };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: {
                  code: err.code || MCP_ERROR_CODES.GATEWAY_ERROR,
                  message: err.message,
                  retryable: err.retryable,
                },
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_skills",
    "List curated ToolYour agent skills (playbooks).",
    { category: z.string().optional() },
    async ({ category }) => {
      let skills = loadSkills();
      if (category) {
        skills = skills.filter(
          (s) => s.category.toLowerCase() === category.toLowerCase()
        );
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ skills }, null, 2) },
        ],
      };
    }
  );

  server.tool(
    "load_skill",
    "Load full skill playbook markdown for a multi-step agent goal.",
    { skillId: z.string() },
    async ({ skillId }) => {
      const content = loadSkillContent(skillId);
      if (!content) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: { code: MCP_ERROR_CODES.SKILL_NOT_FOUND, skillId },
              }),
            },
          ],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: content }] };
    }
  );

  server.tool(
    "run_workflow",
    "Run a server-side multi-step workflow (bills per underlying tool call).",
    {
      workflowId: z.string(),
      input: z.any().optional(),
    },
    async ({ workflowId, input }) => {
      const result = await runWorkflow(workflowId, input || {}, {
        apiKey: ctx.apiKey,
        mcpSessionId: ctx.mcpSessionId,
        registry: ctx.registry,
        logger: ctx.logger,
      });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        isError: result.status === "partial",
      };
    }
  );

  return server;
}
