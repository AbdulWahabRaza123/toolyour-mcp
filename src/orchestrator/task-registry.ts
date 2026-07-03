import fs from "fs";
import { getEnv } from "../config";
import type { McpTaskDef } from "../contracts";

export function loadTasks(): McpTaskDef[] {
  const env = getEnv();
  const tasksPath = env.tasksPath;
  if (!fs.existsSync(tasksPath)) return [];
  const raw = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
  return Array.isArray(raw.tasks) ? raw.tasks : [];
}

export { matchTask, rankTaskSuggestions, normalizeTaskInput } from "./match-task";
