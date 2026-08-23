import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { matchTask, isConfidentMatch } from "../../dist/orchestrator/match-task.js";

const tasks = JSON.parse(
  fs.readFileSync(new URL("../../registry/tasks.json", import.meta.url), "utf8")
).tasks;

describe("convert direction matching", () => {
  it("does not reverse pdf↔word or confuse image vs svg compress", () => {
    const cases = [
      ["pdf to word", "pdf-to-docx", "pdf_to_docx"],
      ["word to pdf", "docx-to-pdf", "docx_to_pdf"],
      ["compress this image", "compress-image", "compressImage"],
      ["compress this SVG", "compress-svg", "compressSvg"],
      ["heic to jpg", "image-to-jpg", "convertToJpg"],
    ];
    for (const [goal, id, target] of cases) {
      const m = matchTask(goal, tasks);
      assert.equal(m?.task.id, id, goal);
      assert.equal(m?.task.target, target, goal);
      assert.equal(isConfidentMatch(goal, tasks, m), true, goal);
    }
  });
});
