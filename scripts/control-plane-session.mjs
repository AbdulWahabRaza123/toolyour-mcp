import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load gitignored experimenter session.env if present.
 * Does not override variables already set (eval / explicit shells win).
 */
export function loadControlPlaneSession() {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".data",
    "control-plane",
    "session.env"
  );
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const key = t.slice(0, i).trim();
    const value = t.slice(i + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = value;
  }
}
