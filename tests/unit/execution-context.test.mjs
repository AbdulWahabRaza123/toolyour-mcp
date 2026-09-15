import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRunContext, inferIntentType } from "../../dist/contracts/execution.js";

describe("canonical execution context", () => {
  it("classifies common intent types", () => {
    assert.equal(inferIntentType("verify the deployment"), "verify");
    assert.equal(inferIntentType("convert this document to PDF"), "transform");
    assert.equal(inferIntentType("monitor this site"), "observe");
    assert.equal(inferIntentType("implement authentication"), "build");
  });

  it("keeps project scope and stable idempotency identity", () => {
    const input = {
      url: "https://example.com",
      projectScope: { projectId: "website", environment: "production" },
    };
    const first = createRunContext("verify the site", input);
    const second = createRunContext("verify the site", input);
    assert.equal(first.intent.projectScope.projectId, "website");
    assert.equal(first.intent.projectScope.environment, "production");
    assert.equal(first.intent.idempotencyKey, second.intent.idempotencyKey);
    assert.notEqual(first.runId, second.runId);
  });

  it("honors an explicit idempotency key", () => {
    const context = createRunContext("run the workflow", {
      idempotencyKey: "customer-release-42",
    });
    assert.equal(context.intent.idempotencyKey, "customer-release-42");
  });
});
