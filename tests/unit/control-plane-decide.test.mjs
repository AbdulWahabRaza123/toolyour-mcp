import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, hashCanonical } from "../../dist/control-plane/hash.js";
import { cancelledDecision, decide } from "../../dist/control-plane/decide.js";

function spec(overrides = {}) {
  return {
    acceptance: [
      {
        id: "ac_tests",
        statement: "tests pass",
        requiredCheckIds: ["chk_test"],
      },
    ],
    checks: [
      {
        id: "chk_test",
        kind: "test",
        command: "node --test tests/add.test.js",
        blocking: true,
      },
    ],
    requiredCheckIds: ["chk_test"],
    maxIterations: 8,
    repeatFailN: 3,
    ...overrides,
  };
}

function job(overrides = {}) {
  const s = overrides.spec || spec();
  return {
    id: "job_1",
    ownerKey: "abc",
    goal: "fix add",
    spec: s,
    specHash: "hash",
    state: "open",
    iteration: 0,
    maxIterations: s.maxIterations,
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 9,
    lastDecision: null,
    iterations: [],
    ...overrides,
    spec: s,
  };
}

function result(checkId, status, fingerprint = "fp1", summary = `${checkId} ${status}`) {
  return {
    checkId,
    status,
    exitCode: status === "pass" ? 0 : 1,
    fingerprint,
    summary,
    logExcerpt: summary,
  };
}

describe("canonicalize / hashCanonical", () => {
  it("same spec → same hash", () => {
    const a = spec();
    const b = spec();
    assert.equal(hashCanonical(a), hashCanonical(b));
  });

  it("object key reorder → same hash", () => {
    const a = { z: 1, a: 2, nested: { b: 1, a: 1 } };
    const b = { a: 2, nested: { a: 1, b: 1 }, z: 1 };
    assert.deepEqual(canonicalize(a), canonicalize(b));
    assert.equal(hashCanonical(a), hashCanonical(b));
  });

  it("changed AC → different hash", () => {
    const a = spec();
    const b = spec({
      acceptance: [
        {
          id: "ac_tests",
          statement: "tests pass HARDER",
          requiredCheckIds: ["chk_test"],
        },
      ],
    });
    assert.notEqual(hashCanonical(a), hashCanonical(b));
  });

  it("changed check → different hash", () => {
    const a = spec();
    const b = spec({
      checks: [
        {
          id: "chk_test",
          kind: "test",
          command: "node --test tests/other.test.js",
          blocking: true,
        },
      ],
    });
    assert.notEqual(hashCanonical(a), hashCanonical(b));
  });

  it("reordered arrays → different hash", () => {
    const a = { ids: ["chk_a", "chk_b"] };
    const b = { ids: ["chk_b", "chk_a"] };
    assert.notEqual(hashCanonical(a), hashCanonical(b));
  });
});

describe("decide()", () => {
  it("cancelled → cancelled (R0)", () => {
    const out = decide(job({ state: "cancelled" }), [result("chk_test", "fail")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "cancelled");
    assert.equal(out.decision.ruleId, "R0");
    assert.equal(out.decision.next_action, null);
    assert.equal(out.decision.requires_human, true);
  });

  it("missing required check → rejected (R1), not a state transition", () => {
    const out = decide(job(), []);
    assert.equal(out.ok, false);
    assert.equal(out.ruleId, "R1");
    assert.equal(out.error.code, "check_required_missing");
  });

  it("impossible to verify with missing check", () => {
    const out = decide(job(), [result("chk_other", "pass")]);
    assert.equal(out.ok, false);
    assert.equal(out.ruleId, "R1");
  });

  it("single failing check → continue (R5)", () => {
    const out = decide(job(), [result("chk_test", "fail", "fpA", "add.test failed")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "continue");
    assert.equal(out.decision.ruleId, "R5");
    assert.equal(out.decision.requires_human, false);
    assert.deepEqual(out.decision.remaining_requirements, ["ac_tests"]);
    assert.equal(out.decision.next_action.type, "fix");
    assert.equal(out.decision.next_action.targetCheckId, "chk_test");
    assert.equal(out.decision.next_action.label, "Fix chk_test: add.test failed");
  });

  it("error check → continue (R2)", () => {
    const out = decide(job(), [result("chk_test", "error", "exit:127", "command not found")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "continue");
    assert.equal(out.decision.ruleId, "R2");
    assert.equal(out.decision.next_action.targetCheckId, "chk_test");
    assert.match(out.decision.next_action.label, /^Fix chk_test: /);
  });

  it("all checks pass → verified (R6)", () => {
    const out = decide(job(), [result("chk_test", "pass")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "verified");
    assert.equal(out.decision.ruleId, "R6");
    assert.equal(out.decision.next_action, null);
    assert.deepEqual(out.decision.remaining_requirements, []);
    assert.equal(out.decision.requires_human, false);
  });

  it("partial pass → continue", () => {
    const s = spec({
      acceptance: [
        { id: "ac_a", statement: "a", requiredCheckIds: ["chk_a"] },
        { id: "ac_b", statement: "b", requiredCheckIds: ["chk_b"] },
      ],
      checks: [
        { id: "chk_a", kind: "test", command: "node --test tests/add.test.js", blocking: true },
        { id: "chk_b", kind: "test", command: "node --test tests/health.test.js", blocking: true },
      ],
      requiredCheckIds: ["chk_a", "chk_b"],
    });
    const out = decide(job({ spec: s }), [
      result("chk_a", "pass"),
      result("chk_b", "fail", "fpB", "health 404"),
    ]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "continue");
    assert.equal(out.decision.ruleId, "R5");
    assert.deepEqual(out.decision.remaining_requirements, ["ac_b"]);
    assert.equal(out.decision.next_action.targetCheckId, "chk_b");
    assert.equal(out.decision.next_action.label, "Fix chk_b: health 404");
  });

  it("empty AC mapping → escalated (R7)", () => {
    const s = spec({
      acceptance: [{ id: "ac_empty", statement: "oops", requiredCheckIds: [] }],
    });
    const out = decide(job({ spec: s }), [result("chk_test", "pass")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "escalated");
    assert.equal(out.decision.ruleId, "R7");
    assert.equal(out.decision.next_action, null);
    assert.equal(out.decision.requires_human, true);
    assert.ok(out.decision.remaining_requirements.includes("ac_empty"));
  });

  it("same fingerprint repeated → escalated (R3)", () => {
    const fail = result("chk_test", "fail", "same-fp");
    const prior = {
      n: 1,
      submittedAt: 1,
      results: [fail],
      decision: { status: "continue", ruleId: "R5" },
    };
    const j = job({
      iteration: 2,
      iterations: [prior, { ...prior, n: 2 }],
    });
    const out = decide(j, [fail]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "escalated");
    assert.equal(out.decision.ruleId, "R3");
  });

  it("different fingerprints → no R3", () => {
    const j = job({
      iteration: 2,
      iterations: [
        { n: 1, submittedAt: 1, results: [result("chk_test", "fail", "fpA")], decision: {} },
        { n: 2, submittedAt: 2, results: [result("chk_test", "fail", "fpB")], decision: {} },
      ],
    });
    const out = decide(j, [result("chk_test", "fail", "fpC")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.ruleId, "R5");
    assert.equal(out.decision.status, "continue");
  });

  it("same fingerprint on different check IDs → no R3", () => {
    const s = spec({
      acceptance: [
        { id: "ac_a", statement: "a", requiredCheckIds: ["chk_a"] },
        { id: "ac_b", statement: "b", requiredCheckIds: ["chk_b"] },
      ],
      checks: [
        { id: "chk_a", kind: "test", command: "node --test tests/add.test.js", blocking: true },
        { id: "chk_b", kind: "test", command: "node --test tests/health.test.js", blocking: true },
      ],
      requiredCheckIds: ["chk_a", "chk_b"],
    });
    const j = job({
      spec: s,
      iterations: [
        {
          n: 1,
          submittedAt: 1,
          results: [result("chk_a", "fail", "shared"), result("chk_b", "pass")],
          decision: {},
        },
        {
          n: 2,
          submittedAt: 2,
          results: [result("chk_a", "fail", "shared"), result("chk_b", "pass")],
          decision: {},
        },
      ],
    });
    const out = decide(j, [
      result("chk_a", "pass"),
      result("chk_b", "fail", "shared"),
    ]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "continue");
    assert.equal(out.decision.ruleId, "R5");
    assert.equal(out.decision.next_action.targetCheckId, "chk_b");
  });

  it("maxIterations → escalated (R4)", () => {
    const s = spec({ maxIterations: 2 });
    const fail = result("chk_test", "fail", "fpX");
    const j = job({
      spec: s,
      maxIterations: 2,
      iterations: [{ n: 1, submittedAt: 1, results: [result("chk_test", "fail", "fpY")], decision: {} }],
    });
    const out = decide(j, [fail]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "escalated");
    assert.equal(out.decision.ruleId, "R4");
  });

  it("all pass at maxIterations → verified (R6)", () => {
    const s = spec({ maxIterations: 2 });
    const j = job({
      spec: s,
      maxIterations: 2,
      iterations: [{ n: 1, submittedAt: 1, results: [result("chk_test", "fail")], decision: {} }],
    });
    const out = decide(j, [result("chk_test", "pass")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "verified");
    assert.equal(out.decision.ruleId, "R6");
  });

  it("inventory failure prevents verification", () => {
    const s = spec({
      acceptance: [
        {
          id: "ac_parser",
          statement: "parser tests exist and pass",
          requiredCheckIds: ["chk_test", "chk_test_inventory"],
        },
      ],
      checks: [
        { id: "chk_test", kind: "test", command: "node --test tests/parser.test.js", blocking: true },
        {
          id: "chk_test_inventory",
          kind: "test",
          command: "node ../../scripts/assert-frozen-file.mjs tests/parser.test.js --sha256 d4ee42787a42f1a35ad334ad795f590acb9c80c18c360e21d15e0241bbf90fab",
          blocking: true,
        },
      ],
      requiredCheckIds: ["chk_test", "chk_test_inventory"],
    });
    const out = decide(job({ spec: s }), [
      result("chk_test", "pass"),
      result("chk_test_inventory", "fail", "missing-file", "tests/parser.test.js missing"),
    ]);
    assert.equal(out.ok, true);
    assert.notEqual(out.decision.status, "verified");
    assert.equal(out.decision.ruleId, "R5");
    assert.ok(out.decision.remaining_requirements.includes("ac_parser"));
  });

  it("impossible to verify with failing check", () => {
    const out = decide(job(), [result("chk_test", "fail")]);
    assert.equal(out.ok, true);
    assert.notEqual(out.decision.status, "verified");
  });

  it("cancelledDecision helper is R0", () => {
    const d = cancelledDecision(job());
    assert.equal(d.status, "cancelled");
    assert.equal(d.ruleId, "R0");
    assert.equal(d.next_action, null);
  });

  it("same treeHash while failing → escalated (R8)", () => {
    const fail = result("chk_test", "fail", "fp-new");
    const prior = {
      n: 1,
      submittedAt: 1,
      treeHash: "same-tree",
      results: [fail],
      decision: { status: "continue", ruleId: "R5" },
    };
    const j = job({
      iterations: [prior, { ...prior, n: 2 }],
    });
    const out = decide(j, [fail], undefined, "same-tree");
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "escalated");
    assert.equal(out.decision.ruleId, "R8");
  });

  it("HIGH declared action without approval blocks verified (R9)", () => {
    const j = job({
      declaredActions: [
        {
          id: "act-1",
          actionClass: "prod_deploy",
          resourceGlob: "apps/api",
          risk: "HIGH",
          label: "prod deploy",
          status: "pending",
          createdAt: 1,
          iterationFrom: 0,
          iterationTo: 8,
        },
      ],
    });
    const out = decide(j, [result("chk_test", "pass")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "continue");
    assert.equal(out.decision.ruleId, "R9");
    assert.equal(out.decision.requires_human, true);
    assert.equal(out.decision.next_action.type, "await_approval");
    assert.equal(out.decision.next_action.targetActionId, "act-1");
  });

  it("approved HIGH action allows verified (R6)", () => {
    const j = job({
      declaredActions: [
        {
          id: "act-1",
          actionClass: "prod_deploy",
          resourceGlob: "apps/api",
          risk: "HIGH",
          label: "prod deploy",
          status: "approved",
          createdAt: 1,
        },
      ],
      approvals: [
        {
          id: "ap-1",
          actionId: "act-1",
          actionClass: "prod_deploy",
          resourceGlob: "apps/api",
          actor: "human",
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
        },
      ],
    });
    const out = decide(j, [result("chk_test", "pass")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "verified");
    assert.equal(out.decision.ruleId, "R6");
  });

  it("unapproved CRITICAL escalates (R9)", () => {
    const j = job({
      declaredActions: [
        {
          id: "act-c",
          actionClass: "drop_table",
          resourceGlob: "db/prod",
          risk: "CRITICAL",
          label: "drop",
          status: "pending",
          createdAt: 1,
        },
      ],
    });
    const out = decide(j, [result("chk_test", "pass")]);
    assert.equal(out.ok, true);
    assert.equal(out.decision.status, "escalated");
    assert.equal(out.decision.ruleId, "R9");
    assert.equal(out.decision.requires_human, true);
  });
});
