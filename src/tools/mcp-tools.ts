import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { MCP_ERROR_CODES } from "../contracts";
import { formatCaughtError } from "../contracts/agent-error";
import { constants } from "../config";
import { RegistryLoader, searchTools } from "../registry/loader";
import { loadSkillContent, loadSkills, enrichAllSkills } from "../skills/loader";
import { runWorkflow } from "../workflow/engine";
import { invokeOperation, solveTask } from "../orchestrator/solve-task";
import { planTask } from "../orchestrator/plan-task";
import { runPlaybook } from "../orchestrator/run-playbook";
import { executeVerifyTask } from "../orchestrator/verify-task";
import {
  applyResponseMode,
  parseResponseMode,
} from "../orchestrator/compact-response";
import { payloadStore } from "../payloads/store";
import { acceptAsyncJob, wantsAsync } from "../runs/async-job";
import { runStore } from "../runs/store";
import { serializeRunPoll } from "../runs/serialize";
import { validateApiKey } from "../auth/session";
import type { Logger } from "../observability/logger";

export interface McpServerContext {
  apiKey: string;
  mcpSessionId: string;
  registry: RegistryLoader;
  logger: Logger;
}

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

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
    "plan_task",
    "Free planning pass: ranked workflow/tool/playbook plan + estimated credits. Does not execute or bill. Typical flow: plan_task → solve_task / run_playbook.",
    {
      goal: z
        .string()
        .describe("User intent in plain language"),
      input: z.any().optional(),
    },
    async (args) => {
      const goal = String(args.goal || "");
      const input = (args.input || {}) as Record<string, unknown>;
      return textResult(planTask(goal, input, ctx.registry));
    }
  );

  registerTool(
    server,
    "solve_task",
    "Primary entry: plain-language goal → workflow/tool with fuzzy matching + confidence gating. Default responseMode=compact (jobReport without duplicated steps). Use full for raw steps, dataRef to store full payload. Local html/text is free unless input.enhance=true. Ambiguous goals return status suggest.",
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
          "Optional: url, html, text, code, sourceHint, enhance (true to bill text APIs on local content)"
        ),
      responseMode: z
        .enum(["compact", "full", "dataRef"])
        .optional()
        .describe("compact (default) | full | dataRef"),
      async: z
        .boolean()
        .optional()
        .describe(
          "If true, return runId immediately and continue server-side; poll get_run or receive mcp.job.finished webhook"
        ),
    },
    async (args) => {
      const goal = String(args.goal || "");
      const input = (args.input || {}) as Record<string, unknown>;
      const mode = parseResponseMode(args.responseMode);
      if (wantsAsync(args.async)) {
        return textResult(
          await acceptAsyncJob({
            kind: "solve_task",
            apiKey: ctx.apiKey,
            logger: ctx.logger,
            work: () => solveTask(goal, input, ctx, mode),
          })
        );
      }
      const result = await solveTask(goal, input, ctx, mode);
      return textResult(
        result,
        (result as { status?: string }).status === "error" ||
          (result as { status?: string }).status === "partial"
      );
    }
  );

  registerTool(
    server,
    "run_playbook",
    "Run a skill's backing workflow (or local content ship) in one call. Bills like run_workflow. Prefer over load_skill → manual steps.",
    {
      skillId: z.string().describe("Skill id from list_skills"),
      input: z.any().optional(),
      responseMode: z.enum(["compact", "full", "dataRef"]).optional(),
      async: z.boolean().optional(),
    },
    async (args) => {
      const skillId = String(args.skillId || "");
      const input = (args.input || {}) as Record<string, unknown>;
      const mode = parseResponseMode(args.responseMode);
      if (wantsAsync(args.async)) {
        return textResult(
          await acceptAsyncJob({
            kind: "run_playbook",
            apiKey: ctx.apiKey,
            logger: ctx.logger,
            work: () => runPlaybook(skillId, input, ctx, mode),
          })
        );
      }
      const result = await runPlaybook(skillId, input, ctx, mode);
      if ((result as { status?: string }).status !== "error") {
        ctx.logger.info("run_playbook_tool", {
          mcpSessionId: ctx.mcpSessionId,
          skillId,
          workflowId: (result as { workflowId?: string }).workflowId,
          transport: "mcp",
        });
      }
      return textResult(
        result,
        (result as { status?: string }).status === "error" ||
          (result as { status?: string }).status === "partial"
      );
    }
  );

  registerTool(
    server,
    "verify_task",
    "Re-run a goal and return deltas vs a baseline jobReport (prior solve_task, verify.after, or get_run payload). Includes remainingFixes, nextActions, and gate (pass|fail). Bills like solve_task. Use after applying fixes. Optional async:true → poll get_run.",
    {
      goal: z.string(),
      input: z.any().optional(),
      baseline: z
        .any()
        .describe(
          "Prior solve_task result, verify_task.after, get_run payload, or raw jobReport"
        ),
      responseMode: z.enum(["compact", "full", "dataRef"]).optional(),
      async: z
        .boolean()
        .optional()
        .describe(
          "If true, return runId immediately; poll get_run (result.status verified|error|…)"
        ),
    },
    async (args) => {
      const goal = String(args.goal || "");
      const input = (args.input || {}) as Record<string, unknown>;
      const mode = parseResponseMode(args.responseMode);
      const baseline = args.baseline;
      const work = () =>
        executeVerifyTask(goal, input, baseline, ctx, mode);
      if (wantsAsync(args.async)) {
        return textResult(
          await acceptAsyncJob({
            kind: "verify_task",
            apiKey: ctx.apiKey,
            logger: ctx.logger,
            work,
          })
        );
      }
      const result = await work();
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
              hint: "Only hasApi tools are exposed. Call discover_tools for an API-backed alternative.",
              nextActions: [
                "discover_tools(query) → get_tool_schema → invoke_tool",
                "Or solve_task with a plain-language goal",
              ],
              retryable: false,
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
          { ...ctx, mcpTool: "invoke_tool" },
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
        return textResult({ error: formatCaughtError(e) }, true);
      }
    }
  );

  registerTool(
    server,
    "list_skills",
    "List curated ToolYour agent skills (playbooks). Each entry includes workflowId and runnable. Prefer run_playbook(skillId) over load_skill + manual steps. fix-verify-* skills re-run audits — use verify_task for deltas.",
    { category: z.string().optional() },
    async (args) => {
      let skills = enrichAllSkills(loadSkills());
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
    "Load full skill playbook markdown. Prefer run_playbook to execute in one step.",
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
    "Fetch a full truncated tool/workflow payload by dataRefId from a summarized or dataRef response. Free — in-process TTL store. Returns 404 if expired.",
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
    "get_run",
    "Poll an async solve_task / run_playbook / run_workflow / verify_task by runId. Free. status=completed means finished — always read resultStatus (suggest|need_input|verified|error|…). REDIS_URL enables cross-replica; webhook optional.",
    {
      runId: z.string().describe("UUID returned when async:true"),
    },
    async (args) => {
      const runId = String(args.runId || "").trim();
      const entry = await runStore.get(runId);
      if (!entry) {
        return textResult(
          {
            error: {
              code: MCP_ERROR_CODES.INVALID_INPUT,
              message: "Run not found or expired",
              hint: "Poll the accepting instance, or set REDIS_URL on MCP for cross-replica get_run. Webhook is optional.",
            },
          },
          true
        );
      }
      try {
        const session = await validateApiKey(
          ctx.apiKey,
          "",
          "node",
          ctx.logger
        );
        if (!runStore.ownsRun(entry, session)) {
          return textResult(
            {
              error: {
                code: MCP_ERROR_CODES.UNAUTHORIZED,
                message: "Run not found or not owned by this API key",
              },
            },
            true
          );
        }
      } catch {
        return textResult(
          {
            error: {
              code: MCP_ERROR_CODES.UNAUTHORIZED,
              message: "Unauthorized",
            },
          },
          true
        );
      }
      return textResult(serializeRunPoll(entry));
    }
  );

  registerTool(
    server,
    "run_workflow",
    "Run a server-side multi-step workflow (bills per underlying tool call). Prefer solve_task or run_playbook when you have a goal/skillId.",
    {
      workflowId: z.string(),
      input: z.any().optional(),
      responseMode: z.enum(["compact", "full", "dataRef"]).optional(),
      async: z.boolean().optional(),
    },
    async (args) => {
      const workflowId = String(args.workflowId || "");
      const input = (args.input || {}) as Record<string, unknown>;
      const mode = parseResponseMode(args.responseMode);
      const work = async () => {
        const result = await runWorkflow(workflowId, input, {
          apiKey: ctx.apiKey,
          mcpSessionId: ctx.mcpSessionId,
          registry: ctx.registry,
          logger: ctx.logger,
          mcpTool: "run_workflow",
          workflowId,
        });
        ctx.logger.info("run_workflow", {
          mcpSessionId: ctx.mcpSessionId,
          workflowId,
          transport: "mcp",
        });
        return applyResponseMode(result, mode);
      };
      if (wantsAsync(args.async)) {
        return textResult(
          await acceptAsyncJob({
            kind: "run_workflow",
            apiKey: ctx.apiKey,
            logger: ctx.logger,
            work,
          })
        );
      }
      const result = await work();
      return textResult(
        result,
        (result as { status?: string }).status === "partial"
      );
    }
  );

  return server;
}
