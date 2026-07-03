import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeLocalHtml } from "../../dist/orchestrator/local-seo.js";
import {
  isLocalDevGoal,
  isLocalhostUrl,
  extractHtmlFromInput,
} from "../../dist/orchestrator/local-dev.js";

describe("local SEO", () => {
  it("flags missing title and description", () => {
    const report = analyzeLocalHtml("<html><body><h1>Hi</h1></body></html>");
    assert.equal(report.billed, false);
    assert.ok(report.summary.criticalCount >= 1);
    assert.ok(report.issues.some((i) => i.category === "title"));
  });

  it("passes basic valid page", () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>ToolYour — Free online tools and API</title>
  <meta name="description" content="A solid meta description that is long enough for search snippets and explains the product clearly to users." />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body><h1>Welcome</h1><img src="/x.png" alt="logo" /></body>
</html>`;
    const report = analyzeLocalHtml(html);
    assert.ok(report.summary.score >= 70);
    assert.equal(report.summary.criticalCount, 0);
  });

  it("detects local dev goals", () => {
    assert.equal(isLocalDevGoal("improve SEO of my local landing page"), true);
    assert.equal(isLocalDevGoal("audit https://example.com"), false);
  });

  it("detects localhost URLs", () => {
    assert.equal(isLocalhostUrl("http://localhost:3000"), true);
    assert.equal(isLocalhostUrl("https://example.com"), false);
  });

  it("extracts html from input aliases", () => {
    const html = extractHtmlFromInput({ htmlContent: "<html></html>" });
    assert.equal(html, "<html></html>");
  });
});
