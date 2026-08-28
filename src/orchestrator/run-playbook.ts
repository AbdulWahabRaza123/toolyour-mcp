import type { Logger } from "../observability/logger";
import type { RegistryLoader } from "../registry/loader";
import { runWorkflow } from "../workflow/engine";
import { loadSkillContent, loadSkills } from "../skills/loader";
import { resolveSkillWorkflowId } from "../skills/enrich";
import { tryContentBridge } from "./content-bridge";
import { hasDirectContent, extractContentBundle } from "./content-input";
import { MCP_ERROR_CODES } from "../contracts";
import { shapeAgentResult, parseResponseMode, type ResponseMode } from "./harness-loop";
import { loadTasks } from "./task-registry";
import {
  applyPayloadAliases,
  hasPayloadInput,
  hasUrlishInput,
  payloadNeedInput,
  urlNeedInput,
} from "./payload-intent";
import {
  buildLocalhostNeedInput,
  resolveLocalhostUrl,
} from "./local-dev";
import { randomUUID } from "crypto";
import { extractJobReport } from "./job-report";
import {
  attachVerificationEnvelope,
  ensureVerificationProfile,
  extractProfileId,
  extractTargetUrl,
  persistVerificationRun,
  regressionVsLastPass,
} from "./verification-loop";

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
  const skillAliases: Record<string, string> = {
    "core-web-vitals": "page-performance",
    "improve-core-web-vitals": "page-performance",
    cwv: "page-performance",
  };
  const resolvedId = skillAliases[id] || id;
  const skills = loadSkills();
  const meta = skills.find((s) => s.id === resolvedId);
  if (!meta) {
    return {
      status: "error" as const,
      error: {
        code: MCP_ERROR_CODES.SKILL_NOT_FOUND,
        message: `Unknown skillId: ${id}`,
      },
    };
  }

  const content = loadSkillContent(resolvedId);
  const workflowId = resolveSkillWorkflowId(meta);

  // Local content ship — no public URL required
  if (
    workflowId === "content-ship-local" ||
    id === "content-ship" ||
    (!workflowId && hasDirectContent(extractContentBundle(input)))
  ) {
    if (!hasDirectContent(extractContentBundle(input))) {
      return {
        status: "need_input" as const,
        code: MCP_ERROR_CODES.NEED_INPUT,
        skillId: id,
        skill: meta,
        message:
          "Pass input.html or input.text for local content ship (enhance defaults to false).",
        missing: ["html", "text"],
        hint: "Local content ship needs HTML or text in input — no public URL required.",
        nextActions: [
          "Re-call run_playbook with input.html or input.text",
          "Set enhance:true only if you want billed text APIs",
        ],
        exampleInput: {
          html: "<!doctype html><html><body>…</body></html>",
          enhance: false,
        },
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
    return shapeAgentResult(
      {
        status: bridge.status,
        skillId: resolvedId,
        playbook: content,
        mode: "content-bridge",
        jobReport: bridge.jobReport,
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
        "This skill has no mapped workflow. Call solve_task with a matching goal, or list_skills for a runnable playbook. Do not start with invoke_tool.",
    };
  }

  const data = applyPayloadAliases({ ...(input || {}) });
  const payloadPlaybook =
    id === "pr-code-gate" || workflowId === "secrets-hygiene-job";
  if (payloadPlaybook && !hasPayloadInput(data)) {
    return payloadNeedInput({
      goal: `run_playbook(${id})`,
      matchedTask: {
        id,
        title: meta.title,
        type: "workflow",
        target: workflowId,
        score: 1,
      },
    });
  }

  if (!payloadPlaybook && playbookRequiresLiveUrl(id, workflowId) && !hasUrlishInput(data)) {
    return urlNeedInput({
      goal: `run_playbook(${id})`,
      matchedTask: {
        id,
        title: meta.title,
        type: "workflow",
        target: workflowId,
        score: 1,
      },
      missing: ["url"],
    });
  }

  const localhostUrl = resolveLocalhostUrl(`run_playbook(${id})`, data);
  if (localhostUrl && !payloadPlaybook) {
    return shapeAgentResult(
      buildLocalhostNeedInput({
        goal: `run_playbook(${id})`,
        url: localhostUrl,
        skillId: id,
        matchedTask: {
          id,
          title: meta.title,
          type: "workflow",
          target: workflowId,
          score: 1,
        },
      }),
      parseResponseMode(responseMode)
    );
  }

  const result = await runWorkflow(workflowId, data, {
    apiKey: ctx.apiKey,
    mcpSessionId: ctx.mcpSessionId,
    registry: ctx.registry,
    logger: ctx.logger,
    mcpTool: "run_playbook",
    skillId: id,
    workflowId,
  });

  ctx.logger.info("run_playbook", {
    mcpSessionId: ctx.mcpSessionId,
    skillId: id,
    workflowId,
    transport: "mcp",
  });

  const mode = parseResponseMode(responseMode);
  const profileIdInput = extractProfileId(data);
  const targetUrl = extractTargetUrl(data);
  const profileMeta = await ensureVerificationProfile({
    apiKey: ctx.apiKey,
    logger: ctx.logger,
    profileId: profileIdInput,
    targetUrl,
    playbook: resolvedId,
    label: typeof data.label === "string" ? data.label : undefined,
    autoCreate: data.autoProfile !== false,
  }).catch(() => ({
    profileId: profileIdInput,
    lastPassSnapshot: null as Record<string, unknown> | null,
    lastRunSnapshot: null as Record<string, unknown> | null,
    lastPassAt: null as string | null,
    lastPassGate: null as string | null,
    lastPassRunId: null as string | null,
  }));

  const activeProfileId = profileMeta.profileId || profileIdInput;
  const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const payload = {
    status: result.status === "completed" ? "completed" : "partial",
    skillId: id,
    workflowId,
    playbookExcerpt: content ? content.slice(0, 1200) : undefined,
    execution: result,
    ...(activeProfileId ? { profileId: activeProfileId } : {}),
  };

  const shaped = shapeAgentResult(payload, mode) as Record<string, unknown>;
  const report = extractJobReport(shaped);
  const loopGate = (shaped.loop as { gate?: string } | undefined)?.gate;
  const vsLastPass = regressionVsLastPass(profileMeta.lastPassSnapshot, report);

  attachVerificationEnvelope(shaped, {
    profileId: activeProfileId,
    targetUrl: targetUrl || report?.url,
    playbook: resolvedId,
    runId,
    baselineRunId: profileMeta.lastPassRunId,
    delta: vsLastPass,
    lastPassAt: profileMeta.lastPassAt,
    lastPassGate: profileMeta.lastPassGate,
    phase: "run",
  });

  if (activeProfileId) {
    await persistVerificationRun({
      apiKey: ctx.apiKey,
      logger: ctx.logger,
      profileId: activeProfileId,
      runPayload: shaped,
      runId,
      gate: loopGate as "pass" | "fail" | "unknown" | undefined,
    });
  }

  return shaped;
}

function playbookRequiresLiveUrl(skillId: string, workflowId: string): boolean {
  const tasks = loadTasks();
  const bySkill = tasks.find((t) => t.id === skillId);
  if (bySkill?.requiredInput?.includes("url")) return true;
  const forWorkflow = tasks.filter(
    (t) => t.type === "workflow" && t.target === workflowId
  );
  if (forWorkflow.length === 0) return false;
  return forWorkflow.every((t) => t.requiredInput?.includes("url"));
}
