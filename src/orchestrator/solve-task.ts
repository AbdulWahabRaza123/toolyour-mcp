import { MCP_ERROR_CODES } from "../contracts";
import type { Logger } from "../observability/logger";
import { runWorkflow } from "../workflow/engine";
import type { RegistryLoader } from "../registry/loader";
import {
  loadTasks,
  matchTask,
  normalizeTaskInput,
  rankTaskSuggestions,
  isConfidentMatch,
} from "./task-registry";
import { searchTools } from "../registry/loader";
import { invokeOperation } from "./invoke-operation";
import { tryContentBridge } from "./content-bridge";
import {
  extractContentBundle,
  hasDirectContent,
} from "./content-input";
import { localDevGuidance } from "./local-dev";
import { incr } from "../observability/counters";
import { constants } from "../config";
import {
  applyResponseMode,
  parseResponseMode,
  type ResponseMode,
} from "./compact-response";

export interface SolveTaskContext {
  apiKey: string;
  mcpSessionId: string;
  registry: RegistryLoader;
  logger: Logger;
}

export type { InvokeOperationContext } from "./invoke-operation";
export { invokeOperation } from "./invoke-operation";

function suggestResponse(
  trimmedGoal: string,
  tasks: ReturnType<typeof loadTasks>,
  registry: RegistryLoader,
  message?: string
) {
  incr("suggestReturns");
  const suggestions = rankTaskSuggestions(trimmedGoal, tasks, 5).filter(
    (s) => s.score >= constants.taskMatchMinScore
  );

  // Hygiene: do not spam unrelated tools when the goal is out of catalog
  const includeTools = suggestions.length > 0;
  const tools = includeTools
    ? searchTools(registry.getManifest(), trimmedGoal, undefined, 5)
    : [];

  return {
    status: "suggest" as const,
    goal: trimmedGoal,
    message:
      message ||
      (suggestions.length === 0 && tools.length === 0
        ? "Out of catalog. ToolYour MCP focuses on SEO, security, documents, conversion, and text — not general chat. Try a specific goal (e.g. 'SEO audit for https://…') or call list_categories / discover_tools."
        : "No high-confidence task match. Review taskSuggestions / toolSuggestions, or call discover_tools with a more specific query."),
    taskSuggestions: suggestions.map((s) => ({
      id: s.task.id,
      title: s.task.title,
      description: s.task.description,
      type: s.task.type,
      target: s.task.target,
      score: s.score,
    })),
    toolSuggestions: tools,
  };
}

export async function solveTask(
  goal: string,
  input: Record<string, unknown> | undefined,
  ctx: SolveTaskContext,
  responseMode: ResponseMode = "compact"
) {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) {
    return {
      status: "error" as const,
      error: {
        code: MCP_ERROR_CODES.INVALID_INPUT,
        message: "goal is required",
      },
    };
  }

  const mode = parseResponseMode(responseMode);
  const tasks = loadTasks();
  const match = matchTask(trimmedGoal, tasks);
  const confident = isConfidentMatch(trimmedGoal, tasks, match);
  const bundle = extractContentBundle(input);
  const hasContent = hasDirectContent(bundle);

  if (match && confident) {
    const bridge = await tryContentBridge(
      trimmedGoal,
      input,
      match.task,
      match.score,
      ctx
    );
    if (bridge) {
      ctx.logger.info("solve_task", {
        mcpSessionId: ctx.mcpSessionId,
        taskId: match.task.id,
        mode: "content-bridge",
        bridgeStatus: bridge.status,
        adapterId: bridge.adapterId,
        transport: "mcp",
      });
      return applyResponseMode(bridge, mode);
    }
  } else if (hasContent) {
    const bridge = await tryContentBridge(
      trimmedGoal,
      input,
      undefined,
      undefined,
      ctx
    );
    if (bridge?.status === "completed") {
      ctx.logger.info("solve_task", {
        mcpSessionId: ctx.mcpSessionId,
        mode: "content-bridge",
        adapterId: bridge.adapterId,
        transport: "mcp",
      });
      return applyResponseMode(bridge, mode);
    }
  }

  if (!match || !confident) {
    return suggestResponse(
      trimmedGoal,
      tasks,
      ctx.registry,
      match && !confident
        ? "Ambiguous or weak task match. Review ranked taskSuggestions and toolSuggestions, then call solve_task with a clearer goal or invoke_tool with an operationId."
        : undefined
    );
  }

  const { task } = match;

  if (task.type === "local") {
    const guidance = localDevGuidance();
    return {
      status: "need_input" as const,
      goal: trimmedGoal,
      code: MCP_ERROR_CODES.LOCAL_PREVIEW_REQUIRED,
      matchedTask: {
        id: task.id,
        title: task.title,
        type: task.type,
        target: task.target,
        score: match.score,
      },
      message: guidance.message,
      options: guidance.options,
      hint: {
        pass_html: "Pass input.html from a rendered page or source file.",
        pass_text: "Pass input.text for copy-focused improvements.",
        pass_code: "Pass input.code (TSX/JSX/HTML) — MCP extracts content automatically.",
        enhance:
          "Local analysis is free by default. Set input.enhance=true to also run billed text APIs.",
      },
      missing: ["html", "text", "code"],
    };
  }

  const normalized = normalizeTaskInput(
    trimmedGoal,
    input,
    task.requiredInput || []
  );

  if (!normalized.ok) {
    return {
      status: "need_input" as const,
      goal: trimmedGoal,
      matchedTask: {
        id: task.id,
        title: task.title,
        type: task.type,
        target: task.target,
      },
      missing: normalized.missing,
      message: `Provide required input fields: ${normalized.missing.join(", ")}`,
    };
  }

  if (task.type === "workflow") {
    const result = await runWorkflow(task.target, normalized.data, {
      apiKey: ctx.apiKey,
      mcpSessionId: ctx.mcpSessionId,
      registry: ctx.registry,
      logger: ctx.logger,
    });

    ctx.logger.info("solve_task", {
      mcpSessionId: ctx.mcpSessionId,
      taskId: task.id,
      mode: "workflow",
      target: task.target,
      transport: "mcp",
    });

    return applyResponseMode(
      {
        status:
          result.status === "completed"
            ? ("completed" as const)
            : ("partial" as const),
        goal: trimmedGoal,
        matchedTask: {
          id: task.id,
          title: task.title,
          type: task.type,
          target: task.target,
          score: match.score,
        },
        execution: result,
      },
      mode
    );
  }

  const route = ctx.registry.getRoute(task.target);
  if (!route) {
    return {
      status: "error" as const,
      error: {
        code: MCP_ERROR_CODES.TOOL_NOT_API_BACKED,
        message: `Matched task points to unavailable tool: ${task.target}`,
      },
    };
  }

  const invoked = await invokeOperation(
    { ...ctx, registry: ctx.registry },
    route,
    task.target,
    normalized.data
  );

  ctx.logger.info("solve_task", {
    mcpSessionId: ctx.mcpSessionId,
    taskId: task.id,
    mode: "tool",
    target: task.target,
    operationId: task.target,
    transport: "mcp",
  });

  return applyResponseMode(
    {
      status: invoked.isError ? ("partial" as const) : ("completed" as const),
      goal: trimmedGoal,
      matchedTask: {
        id: task.id,
        title: task.title,
        type: task.type,
        target: task.target,
        score: match.score,
      },
      execution: {
        operationId: task.target,
        result: invoked.shaped,
        httpStatus: invoked.status,
      },
    },
    mode
  );
}
