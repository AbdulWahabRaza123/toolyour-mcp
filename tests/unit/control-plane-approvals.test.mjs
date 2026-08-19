import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isUnboundedResourceGlob,
  parseDeclaredAction,
  parseApproval,
  pendingDeclaredActions,
} from "../../dist/control-plane/approvals.js";

const job = {
  id: "job_1",
  ownerKey: "abc",
  goal: "g",
  spec: { acceptance: [], checks: [], requiredCheckIds: [], maxIterations: 8, repeatFailN: 3 },
  specHash: "h",
  state: "open",
  iteration: 1,
  maxIterations: 8,
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 9,
  lastDecision: null,
  iterations: [],
};

describe("control-plane approvals", () => {
  it("rejects unbounded resource globs", () => {
    for (const g of ["*", "**", "**/*", "/", "/*", ""]) {
      assert.equal(isUnboundedResourceGlob(g), true, g);
    }
    assert.equal(isUnboundedResourceGlob("apps/api"), false);
  });

  it("parseDeclaredAction rejects approve-all globs", () => {
    const parsed = parseDeclaredAction(
      { actionClass: "prod_deploy", resourceGlob: "*", risk: "HIGH" },
      job
    );
    assert.equal(typeof parsed, "string");
    assert.match(String(parsed), /unbounded/);
  });

  it("CRITICAL approve requires breakGlass", () => {
    const action = parseDeclaredAction(
      { actionClass: "drop_table", resourceGlob: "db/prod", risk: "CRITICAL" },
      job
    );
    assert.equal(typeof action, "object");
    const denied = parseApproval({}, action, "human");
    assert.match(String(denied), /breakGlass/);
    const ok = parseApproval({ breakGlass: true }, action, "human");
    assert.equal(typeof ok, "object");
    assert.equal(ok.breakGlass, true);
  });

  it("pendingDeclaredActions ignores LOW/MEDIUM and approved HIGH", () => {
    const pending = pendingDeclaredActions({
      ...job,
      declaredActions: [
        {
          id: "a",
          actionClass: "prod_deploy",
          resourceGlob: "apps/api",
          risk: "HIGH",
          label: "x",
          status: "pending",
          createdAt: 1,
        },
      ],
    });
    assert.equal(pending.length, 1);
    const covered = pendingDeclaredActions({
      ...job,
      declaredActions: [
        {
          id: "a",
          actionClass: "prod_deploy",
          resourceGlob: "apps/api",
          risk: "HIGH",
          label: "x",
          status: "approved",
          createdAt: 1,
        },
      ],
    });
    assert.equal(covered.length, 0);
  });
});
