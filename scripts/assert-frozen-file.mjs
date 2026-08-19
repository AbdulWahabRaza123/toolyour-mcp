#!/usr/bin/env node
/**
 * Frozen test-file inventory for the control-plane experiment.
 * Run with cwd = experiments/control-plane-fixture.
 *
 *   node ../../scripts/assert-frozen-file.mjs tests/parser.test.js --sha256 <hex>
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rel = String(process.argv[2] || "");
const shaIdx = process.argv.indexOf("--sha256");
const expected = shaIdx >= 0 ? String(process.argv[shaIdx + 1] || "").trim().toLowerCase() : "";

if (!rel || !expected || !/^[0-9a-f]{64}$/.test(expected)) {
  console.error(
    "usage: node ../../scripts/assert-frozen-file.mjs <relative-path> --sha256 <64-hex>"
  );
  process.exit(2);
}

if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
  console.error("path must be a relative file under the fixture cwd (no ..)");
  process.exit(2);
}

const cwd = path.resolve(process.cwd());
const target = path.resolve(cwd, rel);
const relToCwd = path.relative(cwd, target);
if (relToCwd.startsWith("..") || path.isAbsolute(relToCwd)) {
  console.error("path escapes fixture cwd");
  process.exit(2);
}

if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
  console.error(`missing required file: ${rel}`);
  process.exit(1);
}

const actual = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
if (actual !== expected) {
  console.error(`hash mismatch: ${rel}`);
  process.exit(1);
}
console.log(`ok: ${rel}`);
