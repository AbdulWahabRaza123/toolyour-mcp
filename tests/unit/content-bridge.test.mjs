import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import {
  extractContentBundle,
  hasDirectContent,
} from "../../dist/orchestrator/content-input.js";
import {
  findAdapterByGoal,
  findAdapterForTask,
  loadContentAdapters,
} from "../../dist/orchestrator/content-adapters.js";
import { extractLinksFromHtml } from "../../dist/orchestrator/local-content.js";
import { analyzeLocalHtml } from "../../dist/orchestrator/local-seo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const tasks = JSON.parse(
  fs.readFileSync(path.join(root, "registry", "tasks.json"), "utf8")
).tasks;

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head><title>Test Page</title>
<meta name="description" content="A test page">
</head><body>
<h1>Hello World</h1>
<p>Sample paragraph for SEO.</p>
<a href="/about">About</a>
<a href="https://example.com">External</a>
</body></html>`;

describe("content bridge inputs", () => {
  it("extracts html from nested input", () => {
    const bundle = extractContentBundle({ input: { html: SAMPLE_HTML } });
    assert.ok(bundle.html?.includes("<title>Test Page</title>"));
    assert.equal(hasDirectContent(bundle), true);
  });

  it("treats code with markup as html-capable content", () => {
    const bundle = extractContentBundle({ code: SAMPLE_HTML });
    assert.ok(bundle.code);
    assert.equal(hasDirectContent(bundle), true);
  });

  it("extracts plain text input", () => {
    const bundle = extractContentBundle({ text: "Improve this headline copy" });
    assert.equal(bundle.text, "Improve this headline copy");
  });
});

describe("content adapters", () => {
  const adapters = loadContentAdapters();
  assert.ok(adapters.length >= 4, "content-adapters.json should load");

  it("matches SEO goal to on-page-seo adapter", () => {
    const task = tasks.find((t) => t.id === "seo-audit-local");
    const adapter = findAdapterForTask(
      "improve seo of my local landing page",
      task,
      adapters
    );
    assert.equal(adapter?.id, "on-page-seo");
  });

  it("matches link extract goal", () => {
    const adapter = findAdapterByGoal("extract links from my page html", adapters);
    assert.equal(adapter?.id, "links");
  });

  it("matches PII scrub goal", () => {
    const adapter = findAdapterByGoal("scrub pii from this text", adapters);
    assert.equal(adapter?.id, "pii-scrub");
  });
});

describe("local handlers", () => {
  it("runs html seo audit without url", () => {
    const report = analyzeLocalHtml(SAMPLE_HTML, { sourceHint: "index.html" });
    assert.equal(report.mode, "local-html-audit");
    assert.equal(report.billed, false);
    assert.ok(typeof report.summary.issueCount === "number");
  });

  it("extracts internal and external links", () => {
    const report = extractLinksFromHtml(SAMPLE_HTML, "https://mysite.test/");
    assert.equal(report.mode, "html-link-extract");
    assert.ok(report.summary.total >= 2);
    assert.ok(report.summary.internal >= 1);
    assert.ok(report.summary.external >= 1);
  });
});
