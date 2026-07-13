import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchTask } from "../../dist/orchestrator/match-task.js";
import { loadTasks } from "../../dist/orchestrator/task-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goalsPath = path.join(__dirname, "../eval/goals.jsonl");

function loadGoals() {
  const raw = fs.readFileSync(goalsPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("eval goals routing", () => {
  const tasks = loadTasks();

  for (const goal of loadGoals()) {
    if (goal.expectedStatus === "suggest") {
      it(`suggests for off-catalog goal: ${goal.goal.slice(0, 40)}…`, () => {
        const match = matchTask(goal.goal, tasks);
        assert.equal(match, null);
      });
      continue;
    }

    it(`routes "${goal.goal.slice(0, 50)}" → ${goal.expectedJobId}`, () => {
      const match = matchTask(goal.goal, tasks);
      assert.ok(match, `expected a task match for: ${goal.goal}`);
      assert.equal(match.task.id, goal.expectedJobId);
    });
  }
});
