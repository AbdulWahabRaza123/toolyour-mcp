import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMatrixFromJobReport,
  compareEvaluationMatrices,
  computeCompositeScore,
  matrixToCapabilityGaps,
} from "../../dist/orchestrator/evaluation-matrix.js";
import { detectFeatureDomain } from "../../dist/orchestrator/feature-domain.js";
import {
  FEATURE_MEMORY_RECORD_KEEPING,
  attachFeatureMemoryEnvelope,
  buildFeatureMemoryReminder,
  enrichWithFeatureMemory,
  shouldAutoRecordCompletedFeature,
} from "../../dist/orchestrator/feature-memory-loop.js";

describe("evaluation matrix", () => {
  it("builds universal dimensions from job report", () => {
    const matrix = buildMatrixFromJobReport({
      schemaVersion: "toolyour.jobReport@1",
      jobId: "x",
      findings: [{ findingId: "f1", severity: "high", title: "Issue" }],
      scores: { performance: { label: "Perf", value: 40, status: "poor" } },
    });
    assert.ok(matrix.correctness);
    assert.ok(matrix.performance);
    assert.ok(computeCompositeScore(matrix) > 0);
  });

  it("compares matrices for improvement", () => {
    const before = buildMatrixFromJobReport({
      schemaVersion: "toolyour.jobReport@1",
      jobId: "a",
      findings: [{ findingId: "f1", severity: "high", title: "Issue" }],
      scores: {},
      gatePolicy: "ship",
    });
    const after = buildMatrixFromJobReport({
      schemaVersion: "toolyour.jobReport@1",
      jobId: "b",
      findings: [],
      scores: { overall: { label: "Overall", value: 95, status: "good" } },
      gatePolicy: "ship",
    });
    const cmp = compareEvaluationMatrices(before, after);
    assert.ok(["improved", "mixed", "unchanged"].includes(cmp.status));
    assert.ok(cmp.dimensionDeltas.length >= 0);
  });

  it("extracts capability gaps from weak dimensions", () => {
    const matrix = buildMatrixFromJobReport({
      schemaVersion: "toolyour.jobReport@1",
      jobId: "x",
      findings: [{ findingId: "f1", severity: "high", title: "Bad" }],
      scores: {},
    });
    const gaps = matrixToCapabilityGaps(matrix);
    assert.ok(gaps.length >= 1);
  });
});

describe("feature domain", () => {
  it("detects ocr and ship-gate domains", () => {
    assert.equal(detectFeatureDomain("build OCR for scanned PDFs"), "ocr");
    assert.equal(detectFeatureDomain("verify preview deploy production ready"), "ship-gate");
    assert.equal(detectFeatureDomain("random widget"), "random");
  });
});

describe("feature memory record keeping", () => {
  it("exposes system-first auto-record policy", () => {
    assert.equal(FEATURE_MEMORY_RECORD_KEEPING.policy, "toolyour_auto_record");
    assert.match(FEATURE_MEMORY_RECORD_KEEPING.message, /institutional memory/i);
    assert.ok(FEATURE_MEMORY_RECORD_KEEPING.autoCaptureOn.includes("verify_task_gate_pass"));
  });

  it("auto-records on gate pass unless opted out or one-shot", () => {
    assert.equal(
      shouldAutoRecordCompletedFeature({
        goal: "ship gate for https://example.com",
        payload: { loop: { initiate: true, gate: "pass" } },
        gate: "pass",
      }),
      true
    );
    assert.equal(
      shouldAutoRecordCompletedFeature({
        goal: "convert docx to pdf",
        payload: { loop: { initiate: false, gate: "pass" } },
        gate: "pass",
      }),
      false
    );
    assert.equal(
      shouldAutoRecordCompletedFeature({
        goal: "convert docx to pdf",
        input: { featureMemory: { capture: false } },
        payload: { loop: { initiate: true, gate: "pass" } },
        gate: "pass",
      }),
      false
    );
    assert.equal(
      shouldAutoRecordCompletedFeature({
        goal: "build OCR for invoices",
        input: { featureTitle: "Invoice OCR" },
        payload: { loop: { initiate: false, gate: "pass" } },
        gate: "pass",
      }),
      true
    );
  });
});

describe("feature memory envelope", () => {
  it("attachFeatureMemoryEnvelope merges reminder into next", () => {
    const root = { next: "Start with plan_task." };
    attachFeatureMemoryEnvelope(root, {
      schemaVersion: "toolyour.featureMemory@1",
      domain: "ocr",
      recordKeeping: FEATURE_MEMORY_RECORD_KEEPING,
      reminder: "Prior OCR work exists.",
    });
    assert.match(String(root.next), /Prior OCR work exists/);
    assert.equal(root.featureMemory?.domain, "ocr");
  });

  it("buildFeatureMemoryReminder surfaces prior title", () => {
    const reminder = buildFeatureMemoryReminder({
      goal: "add OCR for invoices",
      domain: "ocr",
      matches: [
        {
          featureId: "fm_test",
          title: "Invoice OCR",
          domain: "ocr",
          compositeScore: 80,
          projectName: "billing-app",
        },
      ],
    });
    assert.match(reminder || "", /Invoice OCR/);
    assert.match(reminder || "", /billing-app/);
  });

  it("enrichWithFeatureMemory attaches baseline when match is unavailable", async () => {
    const root = {};
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    await enrichWithFeatureMemory(root, {
      apiKey: "ty_invalid_unit_test_key",
      logger,
      goal: "build OCR for invoice PDFs",
    });
    assert.equal(root.featureMemory?.recordKeeping?.policy, "toolyour_auto_record");
    assert.equal(root.featureMemory?.schemaVersion, "toolyour.featureMemory@1");
    assert.ok(root.featureMemory?.goldenPath?.length >= 1);
  });

  it("skips auto-record when featureMemoryRecord already present", () => {
    assert.equal(
      shouldAutoRecordCompletedFeature({
        goal: "ship gate for https://example.com",
        payload: {
          loop: { initiate: true, gate: "pass" },
          featureMemoryRecord: { featureId: "fm_existing" },
        },
        gate: "pass",
      }),
      false
    );
  });
});
