#!/usr/bin/env node
/**
 * Offline playbook matrix (open-source CI).
 *
 * For every skill → workflow mapping:
 *  1) workflow exists and declares a synthesizer
 *  2) synthesizer is registered
 *  3) if a synth fixture exists: jobReport shape + verify gate contract
 *     (rank-1 nextActions + acceptance when failing)
 *
 * No network / API key / SaaS required.
 *
 * Usage: npm run build && npm run eval:playbooks
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeJobReport } from "../dist/jobs/synthesize.js";
import { SKILL_WORKFLOW_MAP } from "../dist/orchestrator/playbook-map.js";
import {
  buildRemainingFixes,
  computeVerifyGate,
} from "../dist/orchestrator/verify-task.js";
import { loadWorkflows } from "../dist/workflow/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const fixturesPath = path.join(root, "tests/eval/synth-fixtures.json");

let failed = 0;
let fixtureCovered = 0;
let mapped = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function bad(msg) {
  failed++;
  console.error(`✗ ${msg}`);
}
function info(msg) {
  console.log(`· ${msg}`);
}

const workflows = loadWorkflows();
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
const byId = new Map(workflows.map((w) => [w.id, w]));

/** Local / non-workflow playbook targets (same set as lint-skills). */
const LOCAL_OR_PAYLOAD_IDS = new Set([
  "content-ship-local",
  "feature-memory-capture-local",
]);
/** Workflows that intentionally have no jobReport synthesizer. */
const NO_SYNTHESIZER_OK = new Set(["document-convert-pipeline"]);

/** Unique workflow ids referenced by playbooks */
const workflowIds = [...new Set(Object.values(SKILL_WORKFLOW_MAP))].sort();

console.log("--- playbook → workflow → synthesizer ---");
for (const workflowId of workflowIds) {
  mapped++;
  const skills = Object.entries(SKILL_WORKFLOW_MAP)
    .filter(([, wid]) => wid === workflowId)
    .map(([sid]) => sid);

  if (LOCAL_OR_PAYLOAD_IDS.has(workflowId)) {
    ok(`local/payload playbook target: ${workflowId} [${skills.join(", ")}]`);
    continue;
  }

  const wf = byId.get(workflowId);
  if (!wf) {
    bad(`workflow missing: ${workflowId} (skills: ${skills.join(", ")})`);
    continue;
  }
  const synthesizerId = wf.synthesizer;
  if (!synthesizerId) {
    if (NO_SYNTHESIZER_OK.has(workflowId)) {
      ok(`no synthesizer (allowed): ${workflowId}`);
      continue;
    }
    bad(`no synthesizer on workflow ${workflowId}`);
    continue;
  }

  const fix = fixtures[synthesizerId];
  if (!fix) {
    info(
      `chain ok (no fixture yet): ${workflowId} → ${synthesizerId} [${skills[0]}${skills.length > 1 ? ` +${skills.length - 1}` : ""}]`
    );
    continue;
  }

  const report = synthesizeJobReport({
    synthesizerId,
    workflowId,
    jobId: workflowId,
    input: fix.input || { url: "https://example.com" },
    steps: fix.steps || [],
    stepResults: fix.stepResults || {},
  });

  if (!report || report.schemaVersion !== "toolyour.jobReport@1") {
    bad(`synth failed for ${synthesizerId} (${workflowId})`);
    continue;
  }

  const gate = computeVerifyGate(report);
  if (gate !== "pass" && gate !== "fail" && gate !== "unknown") {
    bad(`${workflowId}: unexpected gate ${gate}`);
    continue;
  }

  if (gate === "fail") {
    const fixes = buildRemainingFixes(report);
    const findingCount = Array.isArray(report.findings)
      ? report.findings.length
      : 0;
    if (fixes.length) {
      const top = fixes[0];
      if (!top.acceptance || typeof top.acceptance !== "string") {
        bad(`${workflowId}: remainingFixes[0] missing acceptance`);
        continue;
      }
      if (!top.patchType) {
        bad(`${workflowId}: remainingFixes[0] missing patchType`);
        continue;
      }
    } else if (findingCount > 0) {
      bad(`${workflowId}: findings present but no remainingFixes`);
      continue;
    } else {
      info(
        `fixture ${synthesizerId} @ ${workflowId}: gate=fail via scores (no finding-based fixes)`
      );
    }
  }

  fixtureCovered++;
  ok(
    `fixture ${synthesizerId} @ ${workflowId}: gate=${gate}` +
      (gate === "fail" ? " + verify contract" : "")
  );
}

console.log("\n--- coverage ---");
const pct = mapped ? Math.round((fixtureCovered / mapped) * 100) : 0;
console.log(
  `workflows mapped=${mapped} fixture-covered=${fixtureCovered} (${pct}%)`
);
info(
  "Add fixtures under tests/eval/synth-fixtures.json keyed by synthesizer id to raise coverage."
);

if (failed) {
  console.error(`\nFAILED ${failed}`);
  process.exit(1);
}
console.log("\nOK: playbook eval");
