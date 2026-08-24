#!/usr/bin/env node
/**
 * Offline Tier-1 golden-path shape checks (no API key).
 * Ensures work packages + host instructions stay agent-executable.
 *
 *   npm run build && node scripts/golden-path-tier1.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

const { buildRemainingFixes, buildNextActions, inferRoleHint, inferPatchType } =
  await import("../dist/orchestrator/job-report.js");
const { buildHarnessLoopFromReport, LOOP_NEXT_FAIL } = await import(
  "../dist/orchestrator/harness-loop.js"
);
const { resolveMcpInstructions } = await import("../dist/control-plane/mcp.js");
const { synthesizeSecretsHygiene } = await import(
  "../dist/jobs/secrets-hygiene.js"
);

function ok(msg) {
  console.log("OK:", msg);
}

// --- Host instructions ---
const instructions = resolveMcpInstructions();
assert.match(instructions, /rank-1/i);
assert.match(instructions, /verify_task/);
assert.match(instructions, /does not replace/i);
assert.match(instructions, /localhost/i);
ok("MCP instructions include host contract keywords");

assert.match(LOOP_NEXT_FAIL, /rank-1/i);
assert.match(LOOP_NEXT_FAIL, /acceptance|patchType|roleHint/i);
ok("LOOP_NEXT_FAIL points at work package fields");

// --- Work package shape (ship-like finding) ---
const headerFix = buildRemainingFixes({
  schemaVersion: "toolyour.jobReport@1",
  jobId: "ship-gate-job",
  workflowId: "ship-gate-job",
  gatePolicy: "ship",
  summary: ["test"],
  scores: {
    securityHeaders: { label: "Headers", value: 40, status: "poor" },
    tls: { label: "TLS", value: "ok", status: "good" },
    httpStatus: { label: "HTTP", value: 100, status: "good" },
    mixedContent: { label: "Mixed", value: 100, status: "good" },
  },
  findings: [
    {
      workstream: "securityHeaders",
      severity: "high",
      title: "Missing Content-Security-Policy",
      whyItMatters: "XSS risk",
      howToFix: ["Add Content-Security-Policy header on the origin"],
    },
    {
      workstream: "mixedContent",
      severity: "low",
      title: "No mixed-content issues detected",
      whyItMatters: "ok",
      howToFix: [],
    },
  ],
  prioritizedActions: [],
  toolsUsed: ["securityHeadersAnalyzer"],
});

assert.equal(headerFix.length, 1, "pass-noise finding filtered");
assert.equal(headerFix[0].patchType, "http-header");
assert.equal(headerFix[0].roleHint, "config");
assert.match(headerFix[0].acceptance, /Done when:/i);
const next = buildNextActions(headerFix);
assert.equal(next.length, 1);
assert.equal(next[0].roleHint, "config");
assert.ok(next[0].acceptance);
ok("ship-like remainingFixes: rank-1, roleHint, acceptance; noise filtered");

assert.equal(inferRoleHint(inferPatchType("secrets", "stripe-key")), "config");
ok("secrets patchType → config roleHint");

assert.equal(inferPatchType("securityTxt", "security.txt present"), "file");
assert.equal(
  inferRoleHint(inferPatchType("securityTxt", "security.txt present")),
  "edit"
);
assert.equal(inferPatchType("sri", "Missing integrity attribute"), "file");
ok("security.txt / SRI patchType → file + edit");

// --- Loop attachment ---
const looped = buildHarnessLoopFromReport(
  {
    status: "completed",
    jobReport: {
      schemaVersion: "toolyour.jobReport@1",
      jobId: "ship-gate-job",
      workflowId: "ship-gate-job",
      gatePolicy: "ship",
      summary: ["Ship gate fail"],
      scores: {
        securityHeaders: { label: "Headers", value: 35, status: "poor" },
        tls: { label: "TLS", value: "60d", status: "good" },
        httpStatus: { label: "HTTP", value: 100, status: "good" },
        mixedContent: { label: "Mixed", value: 100, status: "good" },
      },
      findings: [
        {
          workstream: "securityHeaders",
          severity: "high",
          title: "Missing Strict-Transport-Security",
          whyItMatters: "HSTS missing",
          howToFix: ["Add Strict-Transport-Security header"],
        },
      ],
      prioritizedActions: [],
      toolsUsed: ["securityHeadersAnalyzer"],
    },
  },
  "run"
);
assert.ok(looped.remainingFixes.length >= 1);
assert.equal(looped.nextActions.length, 1);
assert.ok(looped.receipt);
assert.match(looped.next, /rank-1|nextActions/i);
ok("harness loop attaches rank-1 + receipt on ship-like report");

// --- Secrets synthesizer closable on dirty paste ---
const dirty = synthesizeSecretsHygiene({
  workflowId: "secrets-hygiene-job",
  input: { text: "STRIPE_KEY=sk_live_51ABCDEFdeadbeefxxxx" },
  steps: [
    { id: "leak", operationId: "secretLeakScanner" },
    { id: "jwt", operationId: "jwtDecoder" },
  ],
  stepResults: {
    leak: {
      status: 200,
      data: {
        status: true,
        result: {
          matchCount: 1,
          matches: [
            {
              type: "stripe-key",
              message: "Looks like a Stripe API key.",
              line: 1,
            },
          ],
        },
      },
    },
    jwt: {
      status: 200,
      skipped: true,
      data: { status: true, result: { skipped: true } },
    },
  },
});
assert.equal(dirty.gatePolicy, "secrets");
assert.ok(dirty.findings.length >= 1);

const secretFixes = buildRemainingFixes(dirty);
assert.ok(secretFixes.length >= 1);
assert.equal(secretFixes[0].roleHint, "config");
ok("secrets dirty paste → remainingFixes with config roleHint");

console.log("\nAll Tier-1 golden-path offline checks passed.");
console.log("Docs: docs/TIER1-GOLDEN-PATH.md · docs/HOST-CONTRACT.md");
void require;
void root;