import type { McpSkillMeta } from "../contracts";
import { skillWorkflowId } from "../orchestrator/playbook-map";

/** Resolved workflow id — frontmatter first, then playbook-map fallback. */
export function resolveSkillWorkflowId(
  skill: Pick<McpSkillMeta, "id" | "workflowId">
): string | undefined {
  return skill.workflowId || skillWorkflowId(skill.id);
}

export type EnrichedSkillMeta = McpSkillMeta & {
  runnable: boolean;
  /** fix-verify-* skills re-run the same job; prefer verify_task for deltas. */
  verifyOnly: boolean;
  verifyHint?: string;
};

export function enrichSkillMeta(skill: McpSkillMeta): EnrichedSkillMeta {
  const workflowId = resolveSkillWorkflowId(skill);
  const verifyOnly = skill.id.startsWith("fix-verify-");
  return {
    ...skill,
    workflowId,
    runnable: Boolean(workflowId || skill.id === "content-ship"),
    verifyOnly,
    verifyHint: verifyOnly
      ? "Re-runs the same audit. For score deltas, use verify_task(goal, input, baselineJobReport)."
      : undefined,
  };
}

/** Primary playbook skill for a workflow (excludes fix-verify aliases). */
export function skillForWorkflow(
  workflowId: string,
  skills: McpSkillMeta[],
  preferredSkillId?: string
): McpSkillMeta | undefined {
  if (preferredSkillId) {
    const preferred = skills.find((s) => s.id === preferredSkillId);
    if (preferred && resolveSkillWorkflowId(preferred) === workflowId) {
      return preferred;
    }
  }
  const runnable = skills.filter(
    (s) =>
      resolveSkillWorkflowId(s) === workflowId && !s.id.startsWith("fix-verify-")
  );
  return runnable.find((s) => s.id !== "pr-code-gate") || runnable[0];
}

export function enrichAllSkills(skills: McpSkillMeta[]): EnrichedSkillMeta[] {
  return skills.map(enrichSkillMeta);
}
