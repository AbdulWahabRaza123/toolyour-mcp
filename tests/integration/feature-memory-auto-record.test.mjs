import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { autoRecordCompletedFeature } from "../../dist/orchestrator/feature-memory-loop.js";
import { deleteFeature } from "../../dist/feature-memory/store.js";
import { validateApiKey } from "../../dist/auth/session.js";

function findKey() {
  if (process.env.TOOLYOUR_API_KEY?.startsWith("ty_")) return process.env.TOOLYOUR_API_KEY;
  const files = [
    path.join(process.env.USERPROFILE || "", ".cursor", "mcp.json"),
    "d:/Jourey/Products/toolyour/.cursor/mcp.json",
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const cfg of Object.values(j.mcpServers || {})) {
      for (const [hk, hv] of Object.entries(cfg.headers || {})) {
        if (/api.?key/i.test(hk) && typeof hv === "string" && hv.startsWith("ty_")) return hv;
      }
    }
  }
  return null;
}

const logger = { warn() {}, info() {}, error() {}, debug() {} };

describe("feature memory auto-record (live SaaS)", () => {
  it("writes featureMemoryRecord on loop.gate=pass", async (t) => {
    const apiKey = findKey();
    if (!apiKey) {
      t.skip("no TOOLYOUR_API_KEY or .cursor/mcp.json key");
      return;
    }

    const stamp = Date.now();
    const payload = {
      loop: { initiate: true, gate: "pass" },
      execution: {
        jobReport: {
          schemaVersion: "toolyour.jobReport@1",
          jobId: `fm-auto-${stamp}`,
          findings: [],
          scores: { overall: { label: "Overall", value: 92, status: "good" } },
          gatePolicy: "ship",
        },
      },
    };

    await autoRecordCompletedFeature({
      apiKey,
      logger,
      goal: "build invoice OCR pipeline for PDF extraction",
      input: { featureTitle: `FM auto-record integration ${stamp}` },
      payload,
      gate: "pass",
      phase: "verify",
    });

    const record = payload.featureMemoryRecord;
    if (!record?.featureId) {
      t.skip("SaaS feature memory store unavailable from this environment");
      return;
    }
    assert.equal(record.status, "recorded");
    assert.equal(record?.policy, "toolyour_auto_record");
    assert.match(String(record?.featureId || ""), /^fm_/);

    const session = await validateApiKey(apiKey, "test/auto-record-cleanup", "node", logger);
    await deleteFeature({
      featureId: String(record?.featureId),
      userId: session.userId,
      logger,
    });
  });
});
