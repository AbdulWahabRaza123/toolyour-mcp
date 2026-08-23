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
import { parseResponseMode, shapeAgentResult } from "../orchestrator/harness-loop";
import { payloadStore } from "../payloads/store";
import { acceptAsyncJob, wantsAsync } from "../runs/async-job";
import { runStore } from "../runs/store";
import { serializeRunPoll } from "../runs/serialize";
import { validateApiKey } from "../auth/session";
import type { Logger } from "../observability/logger";
import {
  FORBIDDEN_EXECUTION_TOOLS,
  registerControlPlaneTools,
  resolveMcpInstructions,
} from "../control-plane/mcp";
import {
  buildLocalhostNeedInput,
  resolveLocalhostUrl,
} from "../orchestrator/local-dev";

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

function assertNoForbiddenExecutionTools(server: McpServer): void {
  const names = Object.keys(
    (server as unknown as { _registeredTools?: Record<string, unknown> })
      ._registeredTools || {}
  );
  for (const name of FORBIDDEN_EXECUTION_TOOLS) {
    if (names.includes(name)) {
      throw new Error(`Forbidden execution tool registered: ${name}`);
    }
  }
}

export function createToolYourMcpServer(ctx: McpServerContext): McpServer {
  const server = new McpServer(
    {
      name: constants.serverName,
      version: constants.serverVersion,
    },
    {
      instructions: resolveMcpInstructions(),
    }
  );

  registerTool(
    server,
    "plan_task",
    "Skill-loop planner (SEO, security, ship-gate, catalog). Free: ranked plan + estimated credits. Do not use when the user already has a control-plane jobId — call job_status instead. Read loop.initiate — only start run/verify if true. Out-of-scope and one-shot jobs set loop.initiate false.",
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
    "Run a job from a plain-language goal. Returns loop.line (gate · rank-1 · credits) and loop.initiate — if false, MCP cannot close this with verify_task. If true, apply rank-1 then verify_task.",
    {
      goal: z
        .string()
        .describe(
          "User intent in plain language. Prefer file/HTML/text goals; include https:// only for live-link analysis."
        ),
      input: z
        .any()
        .optional()
        .describe(
          "Prefer text/code/html/json from the workspace. url only for live fetch jobs. enhance=true bills text APIs on local content."
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
    "Run a skill playbook (ship-gate, SEO audit, security audit, …) in one call. Read loop.line first (gate · rank-1 · credits), then loop.remainingFixes. After host-repo fixes, verify_task with this result as baseline. Prefer over load_skill or invoke_tool.",
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
    "Close the loop only when the prior result has loop.initiate true. Requires a usable baseline jobReport. Read loop.line / loop.gate; apply rank-1 loop.nextActions. Stops when loop.stop is set (max_rounds or same_findings) or loop.initiate is false.",
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
    "Advanced catalog search (API-backed tools only). Prefer plan_task → run_playbook / solve_task for ship, SEO, and security jobs. Use this only when you need a specific operationId.",
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
    "Advanced: JSON schema for one operationId before invoke_tool. Skip this for ship/SEO/security jobs — use run_playbook or solve_task.",
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
    "Advanced: run one API-backed tool by operationId. Prefer run_playbook or solve_task for jobs. After a jobReport, apply loop.remainingFixes then verify_task — do not re-invoke the same tool.",
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
                "solve_task or run_playbook for the job",
                "discover_tools → get_tool_schema → invoke_tool only for a one-off operationId",
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
    "List skill playbooks. Prefer run_playbook(skillId) immediately. Primary jobs: ship-gate, seo-site-audit, web-security-audit. After a run, verify_task — do not invoke_tool.",
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
    "Run a named multi-step job by workflowId. Prefer run_playbook (skill) or solve_task (goal). Returns loop.remainingFixes; then verify_task.",
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
        const localhostUrl = resolveLocalhostUrl(`run_workflow(${workflowId})`, input);
        if (localhostUrl) {
          return shapeAgentResult(
            buildLocalhostNeedInput({
              goal: `run_workflow(${workflowId})`,
              url: localhostUrl,
            }),
            mode
          );
        }
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
        return shapeAgentResult(result, mode);
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

  registerControlPlaneTools(server, registerTool, ctx, { approvals: true });

  assertNoForbiddenExecutionTools(server);
  return server;
}
