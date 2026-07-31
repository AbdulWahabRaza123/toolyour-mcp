import { defsCache } from "../registry/defs-cache";
import type { McpTaskDef } from "../contracts";

export function loadTasks(): McpTaskDef[] {
  return defsCache.getTasks();
}

export {
  matchTask,
  rankTaskSuggestions,
  normalizeTaskInput,
  isConfidentMatch,
} from "./match-task";
