import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileNativeActionCatalog } from "../../dist/actions/native-catalog.js";

test("every native route compiles into one valid conservative action contract", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../../registry/manifest.json", import.meta.url), "utf8"));
  const actions = compileNativeActionCatalog(manifest);

  assert.equal(actions.length, Object.keys(manifest.routes).length);
  assert.equal(new Set(actions.map((action) => action.id)).size, actions.length);
  assert.ok(actions.every((action) => action.evidence.length > 0));
  assert.ok(actions.every((action) => action.completionTest));
});

test("non-read native routes are never silently admitted without approval", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../../registry/manifest.json", import.meta.url), "utf8"));
  const actions = compileNativeActionCatalog(manifest);
  for (const action of actions) {
    if (action.risk !== "read_only") {
      assert.equal(action.risk, "approval_required");
      assert.equal(action.requiresHumanApproval, true);
      assert.equal(action.idempotency, "key_required");
    }
  }
});
