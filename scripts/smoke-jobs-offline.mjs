#!/usr/bin/env node
/**
 * Offline job workflow validator — no live MCP/API required.
 * Checks synthesizer ↔ workflow ↔ task parity and eval goal routing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSynthesizerIds } from "../dist/jobs/synthesize.js";
import { loadTasks } from "../dist/orchestrator/task-registry.js";
import { matchTask } from "../dist/orchestrator/match-task.js";
import { loadWorkflows } from "../dist/workflow/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const goalsPath = path.join(root, "tests/eval/goals.jsonl");
const brandPath = path.join(root, "../toolbox/utils/brand.ts");

let failed = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function bad(msg) {
  failed++;
  console.error(`✗ ${msg}`);
}

const synthesizers = new Set(listSynthesizerIds());
const workflows = loadWorkflows();
const tasks = loadTasks();
const workflowIds = new Set(workflows.map((w) => w.id));

console.log("--- Synthesizer ↔ workflow ---");
for (const wf of workflows) {
  if (!wf.synthesizer) continue;
  if (synthesizers.has(wf.synthesizer)) {
    ok(`workflow ${wf.id} → synthesizer ${wf.synthesizer}`);
  } else {
    bad(`workflow ${wf.id} missing synthesizer: ${wf.synthesizer}`);
  }
}

for (const id of synthesizers) {
  const used = workflows.some((w) => w.synthesizer === id);
  if (used) ok(`synthesizer ${id} is referenced`);
  else bad(`orphan synthesizer: ${id}`);
}

console.log("\n--- Task ↔ workflow ---");
for (const task of tasks) {
  if (task.type !== "workflow") continue;
  if (workflowIds.has(task.target)) {
    ok(`task ${task.id} → ${task.target}`);
  } else {
    bad(`task ${task.id} unknown workflow: ${task.target}`);
  }
}

console.log("\n--- Brand job list (toolbox) ---");
if (fs.existsSync(brandPath)) {
  const brandSrc = fs.readFileSync(brandPath, "utf8");
  const ids = [...brandSrc.matchAll(/id:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id) => id.includes("-job") || id === "full-seo-audit" || id === "document-convert-pipeline");
  for (const id of ids) {
    if (workflowIds.has(id)) ok(`brand.mcpJobWorkflows includes live workflow ${id}`);
    else bad(`brand.mcpJobWorkflows stale: ${id}`);
  }
} else {
  console.log("(skip brand.ts — not found)");
}

console.log("\n--- Eval goals routing ---");
const goals = fs
  .readFileSync(goalsPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l));

for (const goal of goals) {
  if (goal.expectedStatus === "suggest") {
    const match = matchTask(goal.goal, tasks);
    if (!match) ok(`negative goal → suggest: ${goal.goal.slice(0, 40)}…`);
    else bad(`negative goal matched task ${match.task.id}: ${goal.goal}`);
    continue;
  }
  const match = matchTask(goal.goal, tasks);
  if (match?.task.id === goal.expectedJobId) {
    ok(`${goal.category}: ${goal.goal.slice(0, 45)}… → ${goal.expectedJobId}`);
  } else {
    bad(
      `goal routed to ${match?.task.id ?? "null"}, expected ${goal.expectedJobId}: ${goal.goal}`
    );
  }
}

console.log("\n--- Job workflow inventory ---");
const jobWorkflows = workflows.filter((w) => w.synthesizer);
console.log(`${jobWorkflows.length} synthesizer workflows, ${tasks.filter((t) => t.type === "workflow").length} workflow tasks, ${synthesizers.size} synthesizers`);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll offline job checks passed.");
