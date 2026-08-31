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

const workflows = JSON.parse(
  fs.readFileSync(path.join(root, "registry", "workflows.json"), "utf8")
);
const workflowIds = new Set((workflows.workflows || []).map((w) => w.id));
const localWorkflowIds = new Set(["content-ship-local", "feature-memory-capture-local"]);

function loadSkillWorkflowMap() {
  const src = fs.readFileSync(
    path.join(root, "src/orchestrator/playbook-map.ts"),
    "utf8"
  );
  const block = src.match(
    /export const SKILL_WORKFLOW_MAP[^=]*=\s*\{([\s\S]*?)\n\};/
  );
  if (!block) return {};
  const map = {};
  for (const m of block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
    map[m[1]] = m[2];
  }
  return map;
}

const SKILL_WORKFLOW_MAP = loadSkillWorkflowMap();

const skillsDir = path.join(root, "skills");
let failed = 0;

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return meta;
}

for (const file of fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
  const raw = fs.readFileSync(path.join(skillsDir, file), "utf8").replace(/^\uFEFF/, "");
  const meta = parseFrontmatter(raw);
  const id = meta.id || file.replace(/\.md$/, "");

  const m = raw.match(/^operationIds:\s*(.+)$/m);
  if (m) {
    for (const opId of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!ops.has(opId)) {
        console.error(`[lint-skills] ${file}: unknown operationId ${opId}`);
        failed++;
      }
    }
  }

  const mapped = meta.workflowId || SKILL_WORKFLOW_MAP[id];
  if (!mapped && id !== "content-ship") {
    console.error(`[lint-skills] ${file}: no workflowId (frontmatter or map)`);
    failed++;
  } else if (mapped && !workflowIds.has(mapped) && !localWorkflowIds.has(mapped)) {
    console.error(`[lint-skills] ${file}: unknown workflow ${mapped}`);
    failed++;
  }

  if (!meta.description?.trim()) {
    console.error(`[lint-skills] ${file}: empty description`);
    failed++;
  }
}

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
