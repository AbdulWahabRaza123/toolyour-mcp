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
  hasConcreteUrl,
  hasLiveUrlSignal,
  hasPayloadInput,
  impliesRemoteSite,
  localEquivalentTaskId,
  taskRequiresUrl,
} from "./payload-intent";
import { decidePlanLoop, type LoopEligibility } from "./loop-scope";
import { resolveLocalhostUrl } from "./local-dev";

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
 * Vague human health checks without a URL — ask for URL + offer Tier-1 jobs
 * instead of hard out-of-scope.
 */
export function isVagueSiteHealthGoal(goal: string): boolean {
  const g = goal.trim().toLowerCase().replace(/[?.!]+$/g, "");
  if (!g) return false;
  if (/\bhttps?:\/\//i.test(g)) return false;
  if (/\b(localhost|127\.0\.0\.1)\b/i.test(g)) return false;
  // Already names a concrete job — let normal matching handle it.
  if (
    /\b(ship[\s-]?gate|seo\s+audit|security\s+headers?|secrets?|web\s+security|page\s+speed|crawl)\b/i.test(
      g
    )
  ) {
    return false;
  }
  return (
    /\bis\s+(my\s+)?(web\s*)?(site|website|page)\s+(ok|okay|fine|good|healthy|secure|ready|safe)\b/.test(
      g
    ) ||
    /\bhow('s|\s+is)\s+(my\s+)?(web\s*)?(site|website)\b/.test(g) ||
    /^(check|audit|review|test)\s+(my\s+)?(web\s*)?(site|website)$/.test(g) ||
    /^(is\s+it\s+(ok|okay|fine|safe|secure|ready))$/.test(g) ||
    /^(web\s*)?(site|website)\s+(ok|okay|fine|healthy)\??$/.test(g)
  );
}

function vagueSiteHealthPlan(trimmedGoal: string): PlanTaskResult {
  const loop = {
    initiate: false,
    inScope: true,
    reason:
      "Need a public https:// URL (or say which job: ship-gate, SEO audit, or security audit).",
  };
  return {
    status: "plan",
    goal: trimmedGoal,
    free: true,
    estimatedCredits: 0,
    confidence: "medium",
    recommended: {
      kind: "playbook",
      id: "ship-gate",
      title: "Ship Gate",
      score: 6,
      requiredInput: ["url"],
      steps: [
        "securityHeadersAnalyzer",
        "sslTlsCertificateChecker",
        "mixedContentChecker",
        "httpStatusChecker",
        "pageSpeedAnalyzer",
      ],
      workflowId: "ship-gate-job",
    },
    alternatives: [
      {
        kind: "playbook",
        id: "seo-site-audit",
        title: "SEO Site Audit",
        score: 5,
      },
      {
        kind: "playbook",
        id: "web-security-audit",
        title: "Web Security Audit",
        score: 5,
      },
      {
        kind: "playbook",
        id: "pr-code-gate",
        title: "PR Code Gate",
        score: 3,
      },
    ],
    toolHints: [],
    loop,
    next: 'Ask the user for a public https:// URL, then run_playbook("ship-gate", { url }). If they meant SEO or security, use seo-site-audit or web-security-audit instead. Do not start verify_task yet.',
  };
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
  const rawToolHints = includeTools
    ? searchTools(registry.getManifest(), trimmedGoal, undefined, 5).map(
        (t) => ({
          operationId: t.operationId,
          name: t.name,
          category: t.category,
        })
      )
    : [];

  /** Prefer workflow/playbook step operationIds over keyword search noise. */
  function scopedToolHints(stepIds: string[] | undefined): PlanTaskResult["toolHints"] {
    if (!stepIds || stepIds.length === 0) {
      return rawToolHints.slice(0, 0);
    }
    const allow = new Set(stepIds);
    const scoped = rawToolHints.filter((h) => allow.has(h.operationId));
    if (scoped.length > 0) return scoped;
    // Fall back to step ids as hints when search missed them
    return stepIds.slice(0, 8).map((operationId) => ({
      operationId,
      name: operationId,
      category: "workflow",
    }));
  }

  if (!match || !confident) {
    if (isVagueSiteHealthGoal(trimmedGoal)) {
      return vagueSiteHealthPlan(trimmedGoal);
    }
    const topPlaybook = alternatives.find((a) => a.kind === "playbook");
    const confidence = match ? "low" : "none";
    const loop = decidePlanLoop({ confidence });
    // Out-of-catalog / low confidence: do not spam unrelated toolHints.
    const toolHints: PlanTaskResult["toolHints"] = [];
    return {
      status: "plan",
      goal: trimmedGoal,
      free: true,
      estimatedCredits: 0,
      confidence,
      alternatives: confidence === "none" ? [] : alternatives.slice(0, 4),
      toolHints,
      loop,
      next: loop.inScope
        ? "Clarify the goal before running a playbook. Do not start verify_task yet."
        : topPlaybook && confidence === "low"
          ? `Possible playbook "${topPlaybook.id}" — confirm the goal maps to a ToolYour job before running it. Do not start verify_task yet.`
          : "Out of ToolYour MCP scope (SEO, security, ship-gate, documents, conversion, text). Do not start the harness loop.",
    };
  }

  let { task } = match;
  const live = hasLiveUrlSignal(trimmedGoal, input);
  const concreteUrl = hasConcreteUrl(trimmedGoal, input);
  const hasPayload = hasPayloadInput(input);
  const localhostUrl = resolveLocalhostUrl(trimmedGoal, input);
  if (localhostUrl) {
    const loop = decidePlanLoop({
      confidence: "high",
      recommendedKind: "local",
    });
    return {
      status: "plan",
      goal: trimmedGoal,
      free: true,
      estimatedCredits: 0,
      confidence: "high",
      recommended: {
        kind: "local",
        id: "pass-html-or-preview-url",
        title: "Localhost blocked — pass workspace HTML or a public URL",
        score: match.score,
        requiredInput: ["html", "text", "code"],
      },
      alternatives: alternatives.slice(0, 4),
      toolHints: [],
      loop: { ...loop, initiate: false, inScope: true },
      next: `MCP cannot fetch ${localhostUrl}. Pass input.html / input.text / input.code from the workspace, or a public/preview https:// URL (or tunnel). Do not start run_playbook with localhost.`,
    };
  }

  // "SEO audit this site" / "security on my website" without URL → ask for
  // https://; do not flip to local HTML or tell the agent not to ask for a URL.
  const wantsLivePage =
    impliesRemoteSite(trimmedGoal) ||
    (live && !concreteUrl && (taskRequiresUrl(task) || Boolean(localEquivalentTaskId(task.id))));
  if (wantsLivePage && !concreteUrl && !hasPayload) {
    let steps: string[] | undefined;
    let estimatedCredits = 0;
    if (task.type === "workflow") {
      const wf = workflows.find((w) => w.id === task.target);
      steps = wf?.steps.map((s) => s.operationId);
      estimatedCredits = estimateCredits("workflow", steps?.length || 1);
    } else if (task.type === "tool") {
      estimatedCredits = estimateCredits("tool", 1);
    }
    const playbookSkill =
      task.type === "workflow"
        ? skillForWorkflow(task.target, skills, task.id)
        : undefined;
    const localAlt = localEquivalentTaskId(task.id);
    const alts = alternatives
      .filter((a) => a.id !== (playbookSkill?.id || task.id) && a.id !== task.target)
      .slice(0, 3);
    if (localAlt && !alts.some((a) => a.id === localAlt)) {
      const localTask = tasks.find((t) => t.id === localAlt);
      if (localTask) {
        alts.unshift({
          kind: "local",
          id: localTask.id,
          title: localTask.title,
          score: 4,
        });
      }
    }
    const recId = playbookSkill?.id || (task.type === "workflow" ? task.target : task.id);
    const loop = {
      initiate: false,
      inScope: true,
      reason: "Need a public https:// URL before starting this live-site job.",
    };
    return {
      status: "plan",
      goal: trimmedGoal,
      free: true,
      estimatedCredits,
      confidence: "medium",
      recommended: {
        kind: playbookSkill ? "playbook" : task.type,
        id: recId,
        title: playbookSkill?.title || task.title,
        score: match.score,
        requiredInput: ["url"],
        steps,
        workflowId: task.type === "workflow" ? task.target : undefined,
      },
      alternatives: alts.slice(0, 4),
      toolHints: scopedToolHints(steps),
      loop,
      next: playbookSkill
        ? `Ask the user for a public https:// URL, then run_playbook("${playbookSkill.id}", { url }). If they meant local HTML from the repo, pass input.html to solve_task instead. Do not start verify_task yet.`
        : `Ask the user for a public https:// URL in input.url, then re-call plan_task / solve_task. If they meant workspace HTML, pass input.html instead. Do not start verify_task yet.`,
    };
  }

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
      toolHints: scopedToolHints(steps),
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
    toolHints:
      task.type === "tool"
        ? scopedToolHints([task.target])
        : scopedToolHints(steps),
    loop,
    next: loop.initiate
      ? `${runLine} After the run, call verify_task only if that result has loop.initiate true. Do not start with invoke_tool.`
      : `${runLine} ${loop.reason}`,
  };
}
