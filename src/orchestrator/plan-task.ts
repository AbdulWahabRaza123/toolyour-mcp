import { constants } from "../config";
import type { RegistryLoader } from "../registry/loader";
import { searchTools } from "../registry/loader";
import { loadWorkflows } from "../workflow/engine";
import {
  loadTasks,
  matchTask,
  rankTaskSuggestions,
  isConfidentMatch,
} from "./task-registry";
import { loadSkills } from "../skills/loader";
import { enrichAllSkills, skillForWorkflow } from "../skills/enrich";
import {
  hasLiveUrlSignal,
  localEquivalentTaskId,
} from "./payload-intent";
import { decidePlanLoop, type LoopEligibility } from "./loop-scope";

const CREDITS_PER_STEP = 3;
const CREDITS_PER_TOOL = 2;

export interface PlanTaskResult {
  status: "plan";
  goal: string;
  free: true;
  estimatedCredits: number;
  confidence: "high" | "medium" | "low" | "none";
  recommended?: {
    kind: "workflow" | "tool" | "local" | "playbook";
    id: string;
    title: string;
    score?: number;
    requiredInput?: string[];
    steps?: string[];
    workflowId?: string;
  };
  alternatives: Array<{
    kind: "workflow" | "tool" | "local" | "playbook";
    id: string;
    title: string;
    score: number;
  }>;
  toolHints: Array<{
    operationId: string;
    name: string;
    category: string;
  }>;
  next: string;
  loop: LoopEligibility;
}

function estimateCredits(kind: string, stepCount: number): number {
  if (kind === "workflow") return Math.max(CREDITS_PER_TOOL, stepCount * CREDITS_PER_STEP);
  if (kind === "tool") return CREDITS_PER_TOOL;
  return 0;
}

function playbookHit(goal: string, skill: { id: string; title: string; description: string }): boolean {
  const blob = `${skill.id} ${skill.title} ${skill.description}`.toLowerCase();
  const tokens = goal
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);
  return tokens.some((t) => blob.includes(t));
}

/**
 * Free planning pass — no tool execution, no billing.
 */
export function planTask(
  goal: string,
  input: Record<string, unknown> | undefined,
  registry: RegistryLoader
): PlanTaskResult {
  const trimmedGoal = goal.trim();
  const tasks = loadTasks();
  const match = matchTask(trimmedGoal, tasks);
  const confident = isConfidentMatch(trimmedGoal, tasks, match);
  const ranked = rankTaskSuggestions(trimmedGoal, tasks, 5);
  const workflows = loadWorkflows();
  const skills = enrichAllSkills(loadSkills());

  const alternatives: PlanTaskResult["alternatives"] = ranked.map((m) => ({
    kind: m.task.type as "workflow" | "tool" | "local",
    id: m.task.type === "workflow" ? m.task.target : m.task.id,
    title: m.task.title,
    score: m.score,
  }));

  for (const skill of skills) {
    if (!skill.runnable || skill.verifyOnly) continue;
    if (playbookHit(trimmedGoal, skill)) {
      alternatives.push({
        kind: "playbook",
        id: skill.id,
        title: skill.title,
        score: 4,
      });
    }
  }

  const includeTools =
    ranked.length > 0 && ranked[0].score >= constants.taskMatchMinScore;
  const toolHints = includeTools
    ? searchTools(registry.getManifest(), trimmedGoal, undefined, 5).map(
        (t) => ({
          operationId: t.operationId,
          name: t.name,
          category: t.category,
        })
      )
    : [];

  if (!match || !confident) {
    const topPlaybook = alternatives.find((a) => a.kind === "playbook");
    const confidence = match ? "low" : "none";
    const loop = decidePlanLoop({ confidence });
    return {
      status: "plan",
      goal: trimmedGoal,
      free: true,
      estimatedCredits: 0,
      confidence,
      alternatives: alternatives.slice(0, 8),
      toolHints,
      loop,
      next: loop.inScope
        ? "Clarify the goal before running a playbook. Do not start verify_task yet."
        : topPlaybook
          ? `Possible playbook "${topPlaybook.id}" — confirm the goal maps to a ToolYour job before running it. Do not start verify_task yet.`
          : alternatives.length || toolHints.length
            ? "Clarify the goal. Do not start the harness loop until a closable MCP job matches."
            : loop.reason,
    };
  }

  let { task } = match;
  const live = hasLiveUrlSignal(trimmedGoal, input);
  if (!live) {
    const altId = localEquivalentTaskId(task.id);
    const alt = altId ? tasks.find((t) => t.id === altId) : undefined;
    if (alt) task = alt;
  }

  let steps: string[] | undefined;
  let estimatedCredits = 0;

  if (task.type === "workflow") {
    const wf = workflows.find((w) => w.id === task.target);
    steps = wf?.steps.map((s) => s.operationId);
    estimatedCredits = estimateCredits("workflow", steps?.length || 1);
  } else if (task.type === "tool") {
    estimatedCredits = estimateCredits("tool", 1);
  }

  const payloadNext =
    "Pass workspace files as input.html / input.text / input.code. Do not ask for a public URL unless the user asked to analyze a live link.";

  const playbookSkill =
    task.type === "workflow"
      ? skillForWorkflow(task.target, skills, task.id)
      : undefined;

  if (playbookSkill) {
    const confidence = match.score >= 8 ? "high" : "medium";
    const loop = decidePlanLoop({
      confidence,
      recommendedKind: "playbook",
      workflowId: task.target,
    });
    const runLine = live
      ? `Call run_playbook("${playbookSkill.id}", input) with a reachable https:// URL — ~${estimatedCredits} credits estimated.`
      : `Call run_playbook("${playbookSkill.id}", input) with workspace file contents — ~${estimatedCredits} credits estimated. ${payloadNext}`;
    return {
      status: "plan",
      goal: trimmedGoal,
      free: true,
      estimatedCredits,
      confidence,
      recommended: {
        kind: "playbook",
        id: playbookSkill.id,
        title: playbookSkill.title,
        score: match.score,
        requiredInput: task.requiredInput,
        steps,
        workflowId: task.target,
      },
      alternatives: alternatives
        .filter((a) => a.id !== playbookSkill.id && a.id !== task.target)
        .slice(0, 4),
      toolHints,
      loop,
      next: loop.initiate
        ? `${runLine} After the run, call verify_task only if that result has loop.initiate true.`
        : `${runLine} ${loop.reason}`,
    };
  }

  const confidence = match.score >= 8 ? "high" : "medium";
  const loop = decidePlanLoop({
    confidence,
    recommendedKind: task.type,
    workflowId: task.type === "workflow" ? task.target : undefined,
  });
  const runLine =
    task.type === "local"
      ? `Call solve_task with input.html / input.text / input.code (enhance defaults false; set enhance:true to bill text APIs). ${payloadNext}`
      : live
        ? task.type === "workflow"
          ? `Call run_workflow("${task.target}", input) or list_skills for a matching playbook — ~${estimatedCredits} credits estimated.`
          : `Call solve_task(goal) with input.url — ~${estimatedCredits} credits estimated.`
        : task.type === "workflow"
          ? `Call run_workflow("${task.target}", input) with workspace payload (input.text / input.code / input.html) — ~${estimatedCredits} credits estimated. ${payloadNext}`
          : `Call solve_task with workspace payload (input.text / input.code / input.html) — ~${estimatedCredits} credits estimated. ${payloadNext}`;

  return {
    status: "plan",
    goal: trimmedGoal,
    free: true,
    estimatedCredits,
    confidence,
    recommended: {
      kind: task.type,
      id: task.type === "workflow" ? task.target : task.id,
      title: task.title,
      score: match.score,
      requiredInput: task.requiredInput,
      steps,
      workflowId: task.type === "workflow" ? task.target : undefined,
    },
    alternatives: alternatives.filter((a) => a.id !== task.target && a.id !== task.id).slice(0, 4),
    toolHints,
    loop,
    next: loop.initiate
      ? `${runLine} After the run, call verify_task only if that result has loop.initiate true. Do not start with invoke_tool.`
      : `${runLine} ${loop.reason}`,
  };
}
