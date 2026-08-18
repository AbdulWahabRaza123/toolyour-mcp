#!/usr/bin/env node
/**
 * Host check runner for the control-plane experiment.
 * Executes ONLY frozen Check.command strings from job_status, then check_submit.
 *
 *   CONTROL_PLANE_EXPERIMENT=true
 *   MCP_API_KEY=ty_experiment
 *   node scripts/control-plane-host.mjs --job <id> --cwd experiments/control-plane-fixture
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadControlPlaneSession } from "./control-plane-session.mjs";

loadControlPlaneSession();

const apiKey =
  process.env.TOOLYOUR_API_KEY ||
  process.env.MCP_API_KEY ||
  process.env.TY_API_KEY ||
  "ty_experiment";

const runnerToken = String(process.env.CONTROL_PLANE_RUNNER_TOKEN || "").trim();
const CHECK_TIMEOUT_MS = Number(process.env.CONTROL_PLANE_CHECK_TIMEOUT_MS || 30000);
const secretsDir =
  process.env.CONTROL_PLANE_SECRETS_DIR ||
  path.join(os.tmpdir(), "toolyour-control-plane");
const mcpHttp = (
  process.env.MCP_URL || "http://127.0.0.1:3090/mcp/http"
).replace(/\/$/, "");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const jobId = arg("--job");
const cwd = path.resolve(arg("--cwd", process.cwd()));

if (!jobId) {
  console.error("usage: node scripts/control-plane-host.mjs --job <id> [--cwd <fixture>]");
  process.exit(2);
}
if (runnerToken.length < 16) {
  console.error("CONTROL_PLANE_RUNNER_TOKEN is required (16+ chars). Generate with: node scripts/control-plane-print-env.mjs");
  process.exit(2);
}

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    const dataLine = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop();
    return dataLine ? JSON.parse(dataLine) : { raw: text.slice(0, 500) };
  }
}

function toolJson(payload) {
  const t = payload?.result?.content?.[0]?.text;
  if (typeof t === "string") {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return payload;
}

function splitCommand(command) {
  return String(command)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function failingNames(output) {
  const names = new Set();
  const re = /^\s*not ok \d+ - (.+)$/gm;
  let m;
  while ((m = re.exec(output))) names.add(m[1].trim());
  const xRe = /^\s*✖\s+(.+)$/gm;
  while ((m = xRe.exec(output))) names.add(m[1].trim());
  return [...names].sort();
}

function fingerprint(status, exitCode, output) {
  if (status === "pass") return "pass";
  const names = failingNames(output);
  if (names.length) {
    return createHash("sha256").update(names.join("\n"), "utf8").digest("hex");
  }
  return createHash("sha256")
    .update(`exit:${exitCode}\n${String(output).slice(-800)}`, "utf8")
    .digest("hex");
}

function assertionSnippet(output) {
  const m = String(output || "").match(
    /Expected values[\s\S]{0,240}|error: \|-[\s\S]{0,200}/
  );
  return (m ? m[0] : "").replace(/\s+/g, " ").trim().slice(0, 400);
}

function treeHash(root) {
  const lines = [];
  for (const dir of ["lib", "tests"]) {
    const p = path.join(root, dir);
    if (!fs.existsSync(p)) continue;
    for (const name of fs.readdirSync(p).sort()) {
      const fp = path.join(p, name);
      if (!fs.statSync(fp).isFile()) continue;
      const rel = `${dir}/${name}`.replace(/\\/g, "/");
      const hex = createHash("sha256").update(fs.readFileSync(fp)).digest("hex");
      lines.push(`${rel} ${hex}`);
    }
  }
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

function excerpt(text) {
  const s = String(text || "");
  if (s.length <= 8192) return s;
  return `${s.slice(0, 4096)}\n…\n${s.slice(-4096)}`;
}

function runCommand(command) {
  const parts = splitCommand(command);
  if (!parts.length) {
    return Promise.resolve({
      exitCode: 2,
      stdout: "",
      stderr: "empty command",
    });
  }
  return new Promise((resolve) => {
    const child = spawn(parts[0], parts.slice(1), {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ exitCode: 124, stdout, stderr: `${stderr}\ntimeout after ${CHECK_TIMEOUT_MS}ms` });
    }, CHECK_TIMEOUT_MS);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: String(e.message || e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function main() {
  let sessionId = "";
  let id = 0;
  async function rpc(method, params) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Api-Key": apiKey,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(mcpHttp, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    sessionId = res.headers.get("mcp-session-id") || sessionId;
    const payload = parseBody(await res.text());
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(payload).slice(0, 400)}`);
    }
    return payload;
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "toolyour-control-plane-host", version: "0.1.0" },
  });
  if (!sessionId) throw new Error("no mcp-session-id from initialize");

  const statusPayload = await rpc("tools/call", {
    name: "job_status",
    arguments: { jobId },
  });
  const status = toolJson(statusPayload);
  if (status?.error) {
    console.error(JSON.stringify(status, null, 2));
    process.exit(1);
  }
  const checks = status.checks || [];
  if (!checks.length) {
    throw new Error("job_status returned no frozen checks");
  }

  let gitSha;
  try {
    const gitOut = (args) =>
      new Promise((resolve) => {
        const git = spawn("git", args, { cwd, shell: false, windowsHide: true });
        let out = "";
        git.stdout.on("data", (d) => {
          out += d.toString();
        });
        git.on("close", (code) => resolve(code === 0 ? out.trim() : ""));
        git.on("error", () => resolve(""));
      });
    const top = await gitOut(["rev-parse", "--show-toplevel"]);
    const head = await gitOut(["rev-parse", "HEAD"]);
    const sameRepo =
      top &&
      path.resolve(top).toLowerCase() === path.resolve(cwd).toLowerCase();
    gitSha = sameRepo && head ? head : undefined;
  } catch {
    gitSha = undefined;
  }

  const results = [];
  for (const check of checks) {
    const ran = await runCommand(check.command);
    const output = `${ran.stdout}\n${ran.stderr}`;
    let statusName = "error";
    if (ran.exitCode === 0) statusName = "pass";
    else if (ran.exitCode === 127) statusName = "error";
    else statusName = "fail";
    const names = failingNames(output);
    const snippet = assertionSnippet(output);
    const summary = [names.join(", "), snippet].filter(Boolean).join(" — ").slice(0, 500) ||
      (output.trim().split("\n").filter(Boolean).slice(-1)[0] || `exit ${ran.exitCode}`).slice(0, 500);
    results.push({
      checkId: check.id,
      status: statusName,
      exitCode: ran.exitCode,
      fingerprint: fingerprint(statusName, ran.exitCode, output),
      summary,
      logExcerpt: excerpt(output),
    });
  }

  const noncePath = path.join(secretsDir, `${jobId}.nonce`);
  if (!fs.existsSync(noncePath)) {
    console.error(`host-only nonce missing: ${noncePath}`);
    process.exit(1);
  }
  const runnerNonce = fs.readFileSync(noncePath, "utf8").trim();

  const submitPayload = await rpc("tools/call", {
    name: "check_submit",
    arguments: {
      jobId,
      runnerToken,
      runnerNonce,
      gitSha,
      treeHash: treeHash(cwd),
      results,
    },
  });
  const decision = toolJson(submitPayload);
  const decisionPath = path.join(cwd, "DECISION.json");
  fs.writeFileSync(decisionPath, JSON.stringify(decision, null, 2), "utf8");
  console.log(JSON.stringify(decision, null, 2));
  if (decision?.error) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
