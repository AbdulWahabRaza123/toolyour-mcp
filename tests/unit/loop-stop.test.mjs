import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  advanceLoopProgress,
  DEFAULT_MAX_VERIFY_ROUNDS,
  DEFAULT_SAME_FINDINGS_LIMIT,
  fingerprintFromFixes,
  initialLoopProgress,
  withHarnessLoop,
} from "../../dist/orchestrator/harness-loop.js";

const fix = {
  rank: 1,
  findingId: "headers-missing-csp",
  workstream: "headers",
  severity: "high",
  title: "Missing CSP",
  actions: ["Add CSP"],
  source: "finding",
  patchType: "http-header",
  acceptance: "gone",
};

describe("loop stop conditions", () => {
  it("fingerprints remainingFixes stably", () => {
    assert.equal(
      fingerprintFromFixes([fix, { ...fix, findingId: "a-other", title: "Other" }]),
      "a-other|headers-missing-csp"
    );
    assert.equal(fingerprintFromFixes([]), "empty");
  });

  it("initial solve progress is round 0", () => {
    const p = initialLoopProgress([fix]);
    assert.equal(p.round, 0);
    assert.equal(p.maxRounds, DEFAULT_MAX_VERIFY_ROUNDS);
    assert.equal(p.sameFindingsLimit, DEFAULT_SAME_FINDINGS_LIMIT);
    assert.equal(p.sameFindingsStreak, 0);
    assert.equal(p.findingFingerprint, "headers-missing-csp");
    assert.equal(p.stop, undefined);
  });

  it("increments sameFindingsStreak then stops", () => {
    const solve = {
      status: "completed",
      loop: initialLoopProgress([fix]),
    };
    const v1 = advanceLoopProgress({
      baseline: solve,
      remainingFixes: [fix],
      gate: "fail",
      deltaStatus: "unchanged",
    });
    assert.equal(v1.round, 1);
    assert.equal(v1.sameFindingsStreak, 1);
    assert.equal(v1.stop, undefined);

    const mid = { status: "verified", loop: v1 };
    const v2 = advanceLoopProgress({
      baseline: mid,
      remainingFixes: [fix],
      gate: "fail",
      deltaStatus: "unchanged",
    });
    assert.equal(v2.round, 2);
    assert.equal(v2.sameFindingsStreak, 2);
    assert.equal(v2.stop?.code, "same_findings");
  });

  it("resets streak when findings change", () => {
    const solve = {
      status: "completed",
      loop: initialLoopProgress([fix]),
    };
    const v1 = advanceLoopProgress({
      baseline: solve,
      remainingFixes: [fix],
      gate: "fail",
      deltaStatus: "unchanged",
    });
    const mid = { status: "verified", loop: v1 };
    const other = { ...fix, findingId: "headers-hsts", title: "Missing HSTS" };
    const v2 = advanceLoopProgress({
      baseline: mid,
      remainingFixes: [other],
      gate: "fail",
      deltaStatus: "improved",
    });
    assert.equal(v2.sameFindingsStreak, 0);
    assert.equal(v2.stop, undefined);
  });

  it("stops at maxRounds", () => {
    const baseline = {
      status: "verified",
      loop: {
        round: DEFAULT_MAX_VERIFY_ROUNDS - 1,
        maxRounds: DEFAULT_MAX_VERIFY_ROUNDS,
        findingFingerprint: "headers-missing-csp",
        sameFindingsStreak: 0,
        sameFindingsLimit: DEFAULT_SAME_FINDINGS_LIMIT,
      },
    };
    const next = advanceLoopProgress({
      baseline,
      remainingFixes: [{ ...fix, findingId: "headers-new", title: "New" }],
      gate: "fail",
      deltaStatus: "improved",
    });
    assert.equal(next.round, DEFAULT_MAX_VERIFY_ROUNDS);
    assert.equal(next.stop?.code, "max_rounds");
  });

  it("withHarnessLoop clears initiate when stop is set", () => {
    const payload = {
      status: "verified",
      goal: "x",
      delta: {
        status: "unchanged",
        gate: "fail",
        remainingFixes: [fix],
        nextActions: [{ id: "headers-missing-csp", label: "Add CSP" }],
        summary: [],
      },
    };
    const progress = {
      round: 2,
      maxRounds: 5,
      findingFingerprint: "headers-missing-csp",
      sameFindingsStreak: 2,
      sameFindingsLimit: 2,
      stop: {
        code: "same_findings",
        message: "Same remaining findings after verify",
      },
    };
    const shaped = withHarnessLoop(payload, "verify", { progress });
    assert.equal(shaped.loop.initiate, false);
    assert.equal(shaped.loop.stop.code, "same_findings");
    assert.equal(shaped.loop.nextActions.length, 0);
    assert.match(String(shaped.loop.next), /Same remaining findings|escalate/i);
  });
});
