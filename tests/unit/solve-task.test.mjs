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
});
