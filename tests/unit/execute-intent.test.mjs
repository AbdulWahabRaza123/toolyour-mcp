import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRunContext } from "../../dist/contracts/execution.js";
import { executeIntent } from "../../dist/orchestrator/execute-intent.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe("canonical intent execution", () => {
  it("attaches identity and preserves the operation result", async () => {
    const context = createRunContext("build an invoice parser", {
      projectScope: { projectId: "billing" },
    });
    const result = await executeIntent({
      operation: "solve_task",
      context,
      logger,
      run: async () => ({ status: "completed", value: 42 }),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.value, 42);
    assert.equal(result.execution.runId, context.runId);
    assert.equal(result.execution.intentId, context.intent.intentId);
    assert.equal(result.execution.projectScope.projectId, "billing");
    assert.equal(result.billing.settledBy, "gateway_per_tool");
  });

  it("propagates failures for the MCP adapter to handle", async () => {
    const context = createRunContext("verify deployment");
    await assert.rejects(
      () => executeIntent({
        operation: "verify_task",
        context,
        logger,
        run: async () => {
          throw new Error("verification failed");
        },
      }),
      /verification failed/
    );
  });
});
