import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

describe("manifest contract", () => {
  it("has required stats and routes", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "registry", "manifest.json"), "utf8")
    );
    assert.equal(typeof manifest.schemaVersion, "string");
    assert.ok(Array.isArray(manifest.tools));
    assert.ok(manifest.routes.convertToJpg || manifest.routes.docx_to_pdf);
  });
});
