#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "registry", "manifest.json"), "utf8")
);
const ops = new Set(Object.keys(manifest.routes));

const skillsDir = path.join(root, "skills");
let failed = 0;

for (const file of fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
  const raw = fs.readFileSync(path.join(skillsDir, file), "utf8");
  const m = raw.match(/^operationIds:\s*(.+)$/m);
  if (!m) continue;
  for (const id of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!ops.has(id)) {
      console.error(`[lint-skills] ${file}: unknown operationId ${id}`);
      failed++;
    }
  }
}

const workflows = JSON.parse(
  fs.readFileSync(path.join(root, "registry", "workflows.json"), "utf8")
);
for (const wf of workflows.workflows || []) {
  for (const step of wf.steps || []) {
    if (!ops.has(step.operationId)) {
      console.error(`[lint-skills] workflow ${wf.id}: unknown ${step.operationId}`);
      failed++;
    }
  }
}

const tasksPath = path.join(root, "registry", "tasks.json");
if (fs.existsSync(tasksPath)) {
  const workflowIds = new Set((workflows.workflows || []).map((w) => w.id));
  const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf8")).tasks || [];
  for (const task of tasks) {
    if (task.type === "workflow" && !workflowIds.has(task.target)) {
      console.error(`[lint-skills] task ${task.id}: unknown workflow ${task.target}`);
      failed++;
    }
    if (task.type === "tool" && !ops.has(task.target)) {
      console.error(`[lint-skills] task ${task.id}: unknown operationId ${task.target}`);
      failed++;
    }
    if (task.type === "local" && !["html-seo-audit", "html-link-extract", "content-bridge"].includes(task.target)) {
      console.error(`[lint-skills] task ${task.id}: unknown local target ${task.target}`);
      failed++;
    }
  }
}

const adaptersPath = path.join(root, "registry", "content-adapters.json");
if (fs.existsSync(adaptersPath)) {
  const adapters = JSON.parse(fs.readFileSync(adaptersPath, "utf8")).adapters || [];
  for (const adapter of adapters) {
    for (const operationId of adapter.textPipeline || []) {
      if (!ops.has(operationId)) {
        console.error(`[lint-skills] adapter ${adapter.id}: unknown textPipeline ${operationId}`);
        failed++;
      }
    }
    for (const operationId of adapter.urlOperationIds || []) {
      if (!ops.has(operationId)) {
        console.error(`[lint-skills] adapter ${adapter.id}: unknown urlOperationId ${operationId}`);
        failed++;
      }
    }
  }
}

if (failed > 0) process.exit(1);
console.log("OK: skills, workflows, and tasks reference API-backed operationIds");
