import type { McpTaskDef } from "../contracts";

export interface TaskMatch {
  task: McpTaskDef;
  score: number;
}

const URL_RE =
  /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

export function extractUrlFromText(text: string): string | undefined {
  const match = text.match(URL_RE);
  return match?.[0]?.replace(/[.,;:!?)]+$/, "");
}

export function normalizeGoalText(goal: string): string {
  return goal.trim().toLowerCase().replace(/\s+/g, " ");
}

export function scoreTask(goal: string, task: McpTaskDef): number {
  const g = normalizeGoalText(goal);
  let score = 0;

  for (const keyword of task.keywords) {
    const k = keyword.toLowerCase().trim();
    if (!k) continue;
    if (g.includes(k)) {
      score += k.split(/\s+/).length + 2;
    } else {
      const words = k.split(/\s+/).filter(Boolean);
      if (words.length > 1 && words.every((w) => g.includes(w))) {
        score += words.length;
      }
    }
  }

  if (g.includes(task.title.toLowerCase())) {
    score += 3;
  }

  return score;
}

export function matchTask(
  goal: string,
  tasks: McpTaskDef[],
  minScore = 2
): TaskMatch | null {
  let best: TaskMatch | null = null;

  for (const task of tasks) {
    const score = scoreTask(goal, task);
    if (score < minScore) continue;
    if (!best || score > best.score) {
      best = { task, score };
    }
  }

  return best;
}

export function rankTaskSuggestions(
  goal: string,
  tasks: McpTaskDef[],
  limit = 5
): TaskMatch[] {
  return tasks
    .map((task) => ({ task, score: scoreTask(goal, task) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function normalizeTaskInput(
  goal: string,
  input: Record<string, unknown> | undefined,
  required: string[]
): { ok: true; data: Record<string, unknown> } | { ok: false; missing: string[] } {
  const data: Record<string, unknown> = { ...(input || {}) };

  const nested =
    input && typeof input.input === "object" && input.input !== null
      ? (input.input as Record<string, unknown>)
      : null;
  if (nested) {
    Object.assign(data, nested);
    delete data.input;
  }

  if (!data.url) {
    const fromGoal = extractUrlFromText(goal);
    if (fromGoal) data.url = fromGoal;
  }

  const missing = required.filter((key) => {
    const value = data[key];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return { ok: true, data };
}
