#!/usr/bin/env node
/**
 * Restore the control-plane fixture to the planted broken baseline.
 * Operator-only. Do not run this as the coding agent.
 *
 *   node scripts/control-plane-reset-fixture.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "experiments", "control-plane-fixture");
const baselines = path.join(root, "experiments", "control-plane-operator", "baselines");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

copyDir(path.join(baselines, "lib"), path.join(fixture, "lib"));
copyDir(path.join(baselines, "tests"), path.join(fixture, "tests"));

const decision = path.join(fixture, "DECISION.json");
if (fs.existsSync(decision)) fs.unlinkSync(decision);

console.log("fixture reset to planted baseline");
