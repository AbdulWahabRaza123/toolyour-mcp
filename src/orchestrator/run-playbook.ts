import type { Logger } from "../observability/logger";
import type { RegistryLoader } from "../registry/loader";
import { runWorkflow } from "../workflow/engine";
import { loadSkillContent, loadSkills } from "../skills/loader";
import { skillWorkflowId } from "./playbook-map";
import { tryContentBridge } from "./content-bridge";
import { hasDirectContent, extractContentBundle } from "./content-input";
import { MCP_ERROR_CODES } from "../contracts";
import { applyResponseMode, parseResponseMode, type ResponseMode } from "./compact-response";

export interface RunPlaybookContext {
  apiKey: string;
  mcpSessionId: string;
  registry: RegistryLoader;
  logger: Logger;
}

/**
 * Execute a skill's backing workflow (or local content bridge) in one call.
 */
export async function runPlaybook(
  skillId: string,
  input: Record<string, unknown> | undefined,
  ctx: RunPlaybookContext,
  responseMode: ResponseMode = "compact"
) {
  const id = skillId.trim();
  const skills = loadSkills();
  const meta = skills.find((s) => s.id === id);
  if (!meta) {
    return {
      status: "error" as const,
      error: {
        code: MCP_ERROR_CODES.SKILL_NOT_FOUND,
        message: `Unknown skillId: ${id}`,
      },
    };
  }

  const content = loadSkillContent(id);
  const workflowId =
    (meta as { workflowId?: string }).workflowId || skillWorkflowId(id);

  // Local content ship — no public URL required
  if (
    workflowId === "content-ship-local" ||
    id === "content-ship" ||
    (!workflowId && hasDirectContent(extractContentBundle(input)))
  ) {
    if (!hasDirectContent(extractContentBundle(input))) {
      return {
        status: "need_input" as const,
        skillId: id,
        skill: meta,
        message:
          "Pass input.html or input.text for local content ship (enhance defaults to false).",
        missing: ["html", "text"],
        playbook: content,
      };
    }
    const bridge = await tryContentBridge(
      `content ship ${id}`,
      { ...(input || {}), enhance: (input || {}).enhance === true },
      {
        id: "content-ship-local",
        title: meta.title,
        type: "local",
        target: "html-seo-audit",
      },
      10,
      ctx
    );
    if (!bridge) {
      return {
        status: "error" as const,
        error: {
          code: MCP_ERROR_CODES.INVALID_INPUT,
          message: "Could not run local content ship for this input",
        },
      };
    }
    return applyResponseMode(
      {
        status: bridge.status,
        skillId: id,
        playbook: content,
        mode: "content-bridge",
        execution: bridge.execution,
      },
      responseMode
    );
  }

  if (!workflowId) {
    return {
      status: "need_workflow" as const,
      skillId: id,
      skill: meta,
      playbook: content,
      message:
        "This skill has no mapped workflow. Follow the playbook steps with discover_tools / invoke_tool, or call solve_task with a matching goal.",
    };
  }

  const result = await runWorkflow(workflowId, input || {}, {
    apiKey: ctx.apiKey,
    mcpSessionId: ctx.mcpSessionId,
    registry: ctx.registry,
    logger: ctx.logger,
  });

  return applyResponseMode(
    {
      status: result.status === "completed" ? "completed" : "partial",
      skillId: id,
      workflowId,
      playbookExcerpt: content ? content.slice(0, 1200) : undefined,
      execution: result,
    },
    parseResponseMode(responseMode)
  );
}
