import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import {
  extractUrlFromText,
  matchTask,
  normalizeTaskInput,
  scoreTask,
} from "../../dist/orchestrator/match-task.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

describe("solve_task matching", () => {
  const tasks = JSON.parse(
    fs.readFileSync(path.join(root, "registry", "tasks.json"), "utf8")
  ).tasks;

  it("matches SEO audit goal to workflow", () => {
    const match = matchTask("Run a full SEO audit for https://example.com", tasks);
    assert.ok(match);
    assert.equal(match.task.id, "seo-audit");
    assert.equal(match.task.target, "full-seo-audit");
  });

  it("extracts URL from goal text", () => {
    const url = extractUrlFromText("check page speed at https://foo.com/page.");
    assert.equal(url, "https://foo.com/page");
  });

  it("normalizes input with url from goal", () => {
    const normalized = normalizeTaskInput(
      "seo audit https://example.com",
      {},
      ["url"]
    );
    assert.equal(normalized.ok, true);
    if (normalized.ok) {
      assert.equal(normalized.data.url, "https://example.com");
    }
  });

  it("scores docx conversion intent", () => {
    const task = tasks.find((t) => t.id === "docx-to-pdf");
    assert.ok(task);
    const score = scoreTask("convert my docx file to pdf", task);
    assert.ok(score >= 2);
  });

  it("matches core web vitals goal to workflow", () => {
    const match = matchTask("fix core web vitals for https://example.com", tasks);
    assert.ok(match);
    assert.equal(match.task.id, "improve-core-web-vitals");
    assert.equal(match.task.target, "core-web-vitals-job");
  });

  it("matches full SEO optimization goal", () => {
    const match = matchTask("optimize this page for SEO https://example.com", tasks);
    assert.ok(match);
    assert.equal(match.task.id, "full-seo-optimization");
    assert.equal(match.task.target, "full-seo-optimization-job");
  });

  it("keeps seo audit for explicit audit phrasing", () => {
    const match = matchTask("full seo audit https://example.com", tasks);
    assert.ok(match);
    assert.equal(match.task.id, "seo-audit");
  });

  it("matches internal link architecture goals", () => {
    const improve = matchTask("improve internal linking https://example.com", tasks);
    assert.ok(improve);
    assert.equal(improve.task.id, "internal-link-architecture");

    const orphan = matchTask("find orphan pages on https://example.com", tasks);
    assert.ok(orphan);
    assert.equal(orphan.task.id, "internal-link-architecture");
  });

  it("matches technical and social audit goals", () => {
    const tech = matchTask("run technical seo audit on https://example.com", tasks);
    assert.ok(tech);
    assert.equal(tech.task.id, "technical-seo-audit");

    const social = matchTask("audit social preview for https://example.com", tasks);
    assert.ok(social);
    assert.equal(social.task.id, "social-preview-audit");
  });

  it("matches content quality and keyword goals", () => {
    const content = matchTask("content quality audit for https://example.com", tasks);
    assert.ok(content);
    assert.equal(content.task.id, "content-quality-audit");

    const keywords = matchTask("keyword opportunity review https://example.com", tasks);
    assert.ok(keywords);
    assert.equal(keywords.task.id, "keyword-opportunity-review");
  });
});
