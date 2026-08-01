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
import { skillWorkflowId } from "./playbook-map";

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
}

function estimateCredits(kind: string, stepCount: number): number {
  if (kind === "workflow") return Math.max(CREDITS_PER_TOOL, stepCount * CREDITS_PER_STEP);
  if (kind === "tool") return CREDITS_PER_TOOL;
  return 0;
}

/**
 * Free planning pass — no tool execution, no billing.
 */
export function planTask(
  goal: string,
  _input: Record<string, unknown> | undefined,
  registry: RegistryLoader
): PlanTaskResult {
  const trimmedGoal = goal.trim();
  const tasks = loadTasks();
  const match = matchTask(trimmedGoal, tasks);
  const confident = isConfidentMatch(trimmedGoal, tasks, match);
  const ranked = rankTaskSuggestions(trimmedGoal, tasks, 5);
  const workflows = loadWorkflows();
  const skills = loadSkills();

  const alternatives: PlanTaskResult["alternatives"] = ranked.map((m) => ({
    kind: m.task.type as "workflow" | "tool" | "local",
    id: m.task.type === "workflow" ? m.task.target : m.task.id,
    title: m.task.title,
    score: m.score,
  }));

  // Playbook hints
  for (const skill of skills.slice(0, 20)) {
    const wf = skillWorkflowId(skill.id);
    if (!wf) continue;
    const blob = `${skill.id} ${skill.title} ${skill.description}`.toLowerCase();
    const hit = trimmedGoal
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3)
      .some((t) => blob.includes(t));
    if (hit) {
      alternatives.push({
        kind: "playbook",
        id: skill.id,
        title: skill.title,
        score: 3,
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
    return {
      status: "plan",
      goal: trimmedGoal,
      free: true,
      estimatedCredits: 0,
      confidence: match ? "low" : "none",
      alternatives: alternatives.slice(0, 5),
      toolHints,
      next:
        alternatives.length || toolHints.length
          ? "Clarify the goal or call solve_task / run_playbook / discover_tools with a more specific phrase."
          : "Out of catalog. ToolYour MCP covers SEO, security, documents, conversion, and text — not general chat.",
    };
  }

  const { task } = match;
  let steps: string[] | undefined;
  let estimatedCredits = 0;

  if (task.type === "workflow") {
    const wf = workflows.find((w) => w.id === task.target);
    steps = wf?.steps.map((s) => s.operationId);
    estimatedCredits = estimateCredits("workflow", steps?.length || 1);
  } else if (task.type === "tool") {
    estimatedCredits = estimateCredits("tool", 1);
  }

  return {
    status: "plan",
    goal: trimmedGoal,
    free: true,
    estimatedCredits,
    confidence: match.score >= 8 ? "high" : "medium",
    recommended: {
      kind: task.type,
      id: task.type === "workflow" ? task.target : task.target,
      title: task.title,
      score: match.score,
      requiredInput: task.requiredInput,
      steps,
    },
    alternatives: alternatives.filter((a) => a.id !== task.target).slice(0, 4),
    toolHints,
    next:
      task.type === "local"
        ? "Call solve_task with input.html / input.text (enhance defaults false; set enhance:true to bill text APIs)."
        : `Call solve_task(goal) or run_workflow("${task.target}") — ~${estimatedCredits} credits estimated.`,
  };
}
