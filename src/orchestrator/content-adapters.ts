import fs from "fs";
import { getEnv } from "../config";
import { normalizeGoalText } from "./match-task";

export interface ContentAdapterDef {
  id: string;
  keywords: string[];
  taskIds?: string[];
  workflowIds?: string[];
  urlOperationIds?: string[];
  localHandlers?: string[];
  textPipeline?: string[];
  inputKinds?: Array<"html" | "text" | "code">;
}

export function loadContentAdapters(): ContentAdapterDef[] {
  const env = getEnv();
  const adaptersPath = env.contentAdaptersPath;
  if (!fs.existsSync(adaptersPath)) return [];
  const raw = JSON.parse(fs.readFileSync(adaptersPath, "utf8"));
  return Array.isArray(raw.adapters) ? raw.adapters : [];
}

export function scoreAdapter(goal: string, adapter: ContentAdapterDef): number {
  const g = normalizeGoalText(goal);
  let score = 0;
  for (const keyword of adapter.keywords) {
    const k = keyword.toLowerCase().trim();
    if (!k) continue;
    if (g.includes(k)) score += k.split(/\s+/).length + 2;
  }
  return score;
}

export function findAdapterForTask(
  goal: string,
  task: { id: string; type: string; target: string },
  adapters: ContentAdapterDef[]
): ContentAdapterDef | null {
  let best: { adapter: ContentAdapterDef; score: number } | null = null;

  for (const adapter of adapters) {
    let score = scoreAdapter(goal, adapter);
    if (adapter.taskIds?.includes(task.id)) score += 5;
    if (adapter.workflowIds?.includes(task.target)) score += 5;
    if (adapter.urlOperationIds?.includes(task.target)) score += 5;
    if (score < 2) continue;
    if (!best || score > best.score) best = { adapter, score };
  }

  return best?.adapter ?? null;
}

export function findAdapterByGoal(
  goal: string,
  adapters: ContentAdapterDef[]
): ContentAdapterDef | null {
  let best: { adapter: ContentAdapterDef; score: number } | null = null;
  for (const adapter of adapters) {
    const score = scoreAdapter(goal, adapter);
    if (score < 2) continue;
    if (!best || score > best.score) best = { adapter, score };
  }
  return best?.adapter ?? null;
}
