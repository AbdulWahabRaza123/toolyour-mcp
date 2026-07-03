import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { CircuitBreaker } from "../../dist/gateway/circuit-breaker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

describe("circuit breaker", () => {
  it("opens after repeated failures", () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure("node");
    assert.equal(cb.isOpen("node"), true);
  });
});

describe("registry manifest", () => {
  it("loads and includes tools", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "registry", "manifest.json"), "utf8")
    );
    assert.ok(manifest.stats.hasApiIncluded > 0);
    assert.ok(manifest.routes.docx_to_pdf);
  });
});
