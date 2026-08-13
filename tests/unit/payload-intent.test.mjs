import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyPayloadAliases,
  explicitLiveUrlIntent,
  hasPayloadInput,
  localEquivalentTaskId,
  payloadFirstIntent,
} from "../../dist/orchestrator/payload-intent.js";

describe("payload-intent", () => {
  it("detects live-link phrases and https", () => {
    assert.equal(explicitLiveUrlIntent("SEO audit for https://example.com"), true);
    assert.equal(explicitLiveUrlIntent("run Lighthouse on the preview"), true);
    assert.equal(explicitLiveUrlIntent("headers on the site"), true);
    assert.equal(explicitLiveUrlIntent("ship this PR before merge"), false);
    assert.equal(explicitLiveUrlIntent("audit this html before deploy"), false);
  });

  it("detects payload-first phrasing", () => {
    assert.equal(payloadFirstIntent("ship this PR before merge"), true);
    assert.equal(payloadFirstIntent("validate this json from my repo"), true);
    assert.equal(payloadFirstIntent("SEO audit for https://example.com"), false);
  });

  it("maps URL jobs to local equivalents", () => {
    assert.equal(localEquivalentTaskId("ship-gate"), "pr-code-gate");
    assert.equal(localEquivalentTaskId("seo-audit"), "seo-audit-local");
    assert.equal(localEquivalentTaskId("landing-conversion-check"), "content-ship-local");
    assert.equal(localEquivalentTaskId("page-speed"), undefined);
  });

  it("aliases file payloads onto text", () => {
    const aliased = applyPayloadAliases({ code: "const x = 1;" });
    assert.equal(aliased.text, "const x = 1;");
    assert.equal(hasPayloadInput({ html: "<p>hi</p>" }), true);
    assert.equal(hasPayloadInput({ url: "https://example.com" }), false);
  });
});
