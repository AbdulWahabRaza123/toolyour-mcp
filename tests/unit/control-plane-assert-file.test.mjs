import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(root, "scripts", "assert-frozen-file.mjs");
const fixture = path.join(root, "experiments", "control-plane-fixture");
const parserHash = "3babf837d45354f410482c981e0bea827e2b25a11f836e9464eedc86201aa528";

function run(args, cwd = fixture) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

describe("assert-frozen-file.mjs", () => {
  it("passes when hash matches", () => {
    const r = run(["tests/parser.test.js", "--sha256", parserHash]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  it("fails when file is missing", () => {
    const r = run(["tests/does-not-exist.test.js", "--sha256", parserHash]);
    assert.equal(r.status, 1);
  });

  it("fails when contents are gutted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frozen-"));
    fs.writeFileSync(path.join(dir, "parser.test.js"), "import { describe, it } from 'node:test';\n");
    const r = spawnSync(
      process.execPath,
      [script, "parser.test.js", "--sha256", parserHash],
      { cwd: dir, encoding: "utf8" }
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /hash mismatch/);
  });

  it("rejects path escape", () => {
    const r = run(["../control-plane-operator/patches/add.fixed.js", "--sha256", parserHash]);
    assert.equal(r.status, 2);
  });
});
