import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkTimeoutMs,
  isAllowedCheckCommand,
  isPlaywrightCheckCommand,
} from "../../dist/control-plane/host-checks.js";

describe("host Playwright check commands", () => {
  it("allows npx playwright test with a relative spec", () => {
    assert.equal(
      isPlaywrightCheckCommand("npx playwright test e2e/smoke.spec.ts"),
      true
    );
    assert.equal(
      isAllowedCheckCommand(
        "npx playwright test e2e/smoke.spec.ts",
        "playwright",
        new Set()
      ),
      true
    );
  });

  it("allows list reporter and project flags", () => {
    assert.equal(
      isPlaywrightCheckCommand(
        "npx playwright test e2e/smoke.spec.ts --reporter=line --project=chromium"
      ),
      true
    );
  });

  it("rejects UI, shell metacharacters, and path escape", () => {
    assert.equal(isPlaywrightCheckCommand("npx playwright test --ui"), false);
    assert.equal(
      isPlaywrightCheckCommand("npx playwright test e2e/../secret.spec.ts"),
      false
    );
    assert.equal(
      isPlaywrightCheckCommand("npx playwright test e2e/smoke.spec.ts; rm -rf /"),
      false
    );
    assert.equal(isPlaywrightCheckCommand("playwright test"), false);
  });

  it("does not treat playwright as a generic test command", () => {
    assert.equal(
      isAllowedCheckCommand("npx playwright test", "test", new Set()),
      false
    );
  });

  it("uses a longer default timeout for playwright", () => {
    assert.equal(checkTimeoutMs("playwright", {}), 120_000);
    assert.equal(checkTimeoutMs("test", {}), 30_000);
  });
});
