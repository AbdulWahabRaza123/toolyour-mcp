import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isVagueSiteHealthGoal } from "../../dist/orchestrator/plan-task.js";
import { expandQueryForDiscovery } from "../../dist/search/query-expand.js";

describe("vague site health goals", () => {
  it("detects common human phrasings", () => {
    assert.equal(isVagueSiteHealthGoal("is my website okay?"), true);
    assert.equal(isVagueSiteHealthGoal("is my site ok"), true);
    assert.equal(isVagueSiteHealthGoal("check my website"), true);
    assert.equal(isVagueSiteHealthGoal("how is my site"), true);
  });

  it("rejects concrete or out-of-band goals", () => {
    assert.equal(isVagueSiteHealthGoal("ship gate https://example.com"), false);
    assert.equal(isVagueSiteHealthGoal("SEO audit this site"), false);
    assert.equal(isVagueSiteHealthGoal("fix React useEffect"), false);
    assert.equal(isVagueSiteHealthGoal("is my website okay https://a.com"), false);
  });
});

describe("discover query expand", () => {
  it("expands converetr toward converter", () => {
    const variants = expandQueryForDiscovery("converetr");
    assert.ok(variants.includes("converetr"));
    assert.ok(variants.includes("converter"));
  });
});
