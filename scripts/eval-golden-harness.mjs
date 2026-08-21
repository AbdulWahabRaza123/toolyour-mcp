#!/usr/bin/env node
/**
 * Golden harness eval — routing + required jobReport field paths (offline).
 * Uses synthesizer fixtures for jobs that declare requiredJobFields in goals.jsonl.
 *
 * Usage: npm run build && npm run eval:golden
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeJobReport } from "../dist/jobs/synthesize.js";
import { loadTasks } from "../dist/orchestrator/task-registry.js";
import { isConfidentMatch, matchTask } from "../dist/orchestrator/match-task.js";
import {
  buildRemainingFixes,
  computeVerifyGate,
  diffJobReports,
} from "../dist/orchestrator/verify-task.js";
import { loadWorkflows } from "../dist/workflow/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const goalsPath = path.join(root, "tests/eval/goals.jsonl");
const fixturesPath = path.join(root, "tests/eval/synth-fixtures.json");

let failed = 0;
function ok(msg) {
  console.log(`✓ ${msg}`);
}
function bad(msg) {
  failed++;
  console.error(`✗ ${msg}`);
}

function getPath(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function hasRequiredField(report, field) {
  const v = getPath(report, field);
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return true; // empty array still proves field exists
  if (typeof v === "object") return Object.keys(v).length >= 0;
  return true;
}

const tasks = loadTasks();
const workflows = loadWorkflows();
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

const goals = fs
  .readFileSync(goalsPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l));

console.log("--- Routing ---");
for (const goal of goals) {
  if (goal.expectedStatus === "suggest") {
    const match = matchTask(goal.goal, tasks);
    const confident = isConfidentMatch(goal.goal, tasks, match);
    if (!confident) ok(`suggest: ${goal.goal.slice(0, 48)}`);
    else bad(`expected suggest, matched ${match?.task.id}: ${goal.goal}`);
    continue;
  }
  const match = matchTask(goal.goal, tasks);
  if (match?.task.id === goal.expectedJobId) {
    ok(`route ${goal.category}: → ${goal.expectedJobId}`);
  } else {
    bad(
      `route ${goal.category}: got ${match?.task.id ?? "null"}, want ${goal.expectedJobId}`
    );
  }
}

console.log("\n--- requiredJobFields (synth fixtures) ---");
const checked = new Set();
for (const goal of goals) {
  const fields = goal.requiredJobFields;
  if (!fields?.length || !goal.expectedJobId) continue;
  const key = `${goal.expectedJobId}|${fields.join(",")}`;
  if (checked.has(key)) continue;
  checked.add(key);

  const task = tasks.find((t) => t.id === goal.expectedJobId);
  if (!task || task.type !== "workflow") {
    ok(`skip fields (not workflow): ${goal.expectedJobId}`);
    continue;
  }
  const wf = workflows.find((w) => w.id === task.target);
  if (!wf?.synthesizer) {
    bad(`no synthesizer for workflow ${task.target} (${goal.expectedJobId})`);
    continue;
  }
  const fix = fixtures[wf.synthesizer];
  if (!fix) {
    bad(`missing synth fixture for ${wf.synthesizer} (needed by ${goal.expectedJobId})`);
    continue;
  }
  const report = synthesizeJobReport({
    synthesizerId: wf.synthesizer,
    workflowId: wf.id,
    jobId: goal.expectedJobId,
    input: fix.input || { url: "https://example.com" },
    steps: fix.steps || [],
    stepResults: fix.stepResults || {},
  });
  if (!report || report.schemaVersion !== "toolyour.jobReport@1") {
    bad(`synth failed for ${wf.synthesizer}`);
    continue;
  }
  let allOk = true;
  for (const field of fields) {
    if (!hasRequiredField(report, field)) {
      bad(`${goal.expectedJobId}: missing requiredJobField ${field}`);
      allOk = false;
    }
  }
  if (allOk) ok(`fields ${goal.expectedJobId}: ${fields.join(", ")}`);
}

console.log("\n--- verify_task delta contract ---");
const before = {
  schemaVersion: "toolyour.jobReport@1",
  jobId: "t",
  workflowId: "t",
  summary: [],
  scores: { overall: { label: "o", value: 40, status: "poor" } },
  findings: [
    {
      severity: "high",
      title: "Missing CSP",
      whyItMatters: "XSS risk",
      howToFix: ["Add Content-Security-Policy"],
      workstream: "headers",
    },
  ],
  prioritizedActions: [
    {
      rank: 1,
      workstream: "headers",
      action: "Add CSP header",
      expectedImpact: "high",
    },
  ],
  toolsUsed: [],
  steps: {},
};
const afterPass = {
  ...before,
  scores: { overall: { label: "o", value: 90, status: "good" } },
  findings: [],
  prioritizedActions: [],
};
const afterFail = before;
const improved = diffJobReports(before, afterPass);
if (improved.status !== "improved" || improved.gate !== "pass") {
  bad(`expected improved+pass, got ${improved.status}/${improved.gate}`);
} else {
  ok("diff improved → gate pass");
}
const stillFail = diffJobReports(before, afterFail);
if (stillFail.gate !== "fail" || stillFail.remainingFixes.length < 1) {
  bad("expected fail gate with remainingFixes");
} else {
  ok(`remainingFixes=${stillFail.remainingFixes.length}, nextActions=${stillFail.nextActions.length}`);
}
if (stillFail.nextActions.length !== 1) {
  bad(`expected rank-1 nextActions, got ${stillFail.nextActions.length}`);
} else {
  ok("nextActions is rank-1 only");
}
const fixes = buildRemainingFixes(afterFail);
if (computeVerifyGate(afterFail) !== "fail" || fixes[0]?.actions?.[0] !== "Add Content-Security-Policy") {
  bad("buildRemainingFixes missing howToFix");
} else {
  ok("buildRemainingFixes uses finding.howToFix");
}
if (fixes[0]?.patchType !== "http-header" || !fixes[0]?.acceptance) {
  bad("buildRemainingFixes missing patchType/acceptance");
} else {
  ok("buildRemainingFixes includes patchType + acceptance");
}

console.log("\n--- ship-gate gate policy ---");
{
  const shipFix = fixtures["developer-ship-checklist"];
  if (!shipFix) {
    bad("missing developer-ship-checklist fixture");
  } else {
    const shipReport = synthesizeJobReport({
      synthesizerId: "developer-ship-checklist",
      workflowId: "ship-gate-job",
      jobId: "ship-gate",
      input: shipFix.input || { url: "https://example.com" },
      steps: shipFix.steps || [],
      stepResults: shipFix.stepResults || {},
    });
    if (!shipReport || shipReport.gatePolicy !== "ship") {
      bad(`ship report missing gatePolicy=ship (got ${shipReport?.gatePolicy})`);
    } else if (computeVerifyGate(shipReport) !== "fail") {
      bad(`expected ship fixture gate=fail, got ${computeVerifyGate(shipReport)}`);
    } else {
      ok("ship-gate fixture fails under ship gatePolicy");
    }

    const shipPass = {
      ...shipReport,
      findings: [],
      scores: {
        overall: { label: "Ship readiness", value: 90, status: "good" },
        securityHeaders: { label: "Security headers", value: 90, status: "good" },
        tls: { label: "TLS", value: "90d", status: "good" },
        mixedContent: { label: "Mixed content", value: 95, status: "good" },
        httpStatus: { label: "HTTP status", value: 100, status: "good" },
        performance: { label: "Page speed proxy", value: 70, status: "needs_improvement" },
      },
    };
    if (computeVerifyGate(shipPass) !== "pass") {
      bad(`ship pass with speed NI should pass, got ${computeVerifyGate(shipPass)}`);
    } else {
      ok("ship-gate allows performance needs_improvement when criticals are good");
    }

    const shipNiHeaders = {
      ...shipPass,
      scores: {
        ...shipPass.scores,
        securityHeaders: {
          label: "Security headers",
          value: 65,
          status: "needs_improvement",
        },
      },
    };
    if (computeVerifyGate(shipNiHeaders) !== "fail") {
      bad("ship should fail when securityHeaders is needs_improvement");
    } else {
      ok("ship-gate fails on critical needs_improvement");
    }
  }
}

if (failed) {
  console.error(`\nFAILED ${failed}`);
  process.exit(1);
}
console.log("\nOK: golden harness");
