#!/usr/bin/env node
/**
 * Start a frozen control-plane job from experiments/jobs/task-N.json
 *
 *   node scripts/control-plane-start-job.mjs --task 1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadControlPlaneSession } from "./control-plane-session.mjs";

loadControlPlaneSession();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const jobsDir = path.join(root, "experiments", "jobs");

const apiKey =
  process.env.TOOLYOUR_API_KEY ||
  process.env.MCP_API_KEY ||
  process.env.TY_API_KEY ||
  "ty_experiment";

const mcpHttp = (process.env.MCP_URL || "http://127.0.0.1:3090/mcp/http").replace(
  /\/$/,
  ""
);

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const task = String(arg("--task", "1")).replace(/^task-/, "");
const jobPath = path.join(jobsDir, `task-${task}.json`);
if (!fs.existsSync(jobPath)) {
  console.error(`unknown task: ${task} (${jobPath})`);
  process.exit(2);
}

const startToken = String(process.env.CONTROL_PLANE_START_TOKEN || "").trim();
if (startToken.length < 16) {
  console.error(
    "CONTROL_PLANE_START_TOKEN is required (16+ chars). Generate with: node scripts/control-plane-print-env.mjs"
  );
  process.exit(2);
}

const arguments_ = { taskId: `task-${task}`, startToken };

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
    clientInfo: { name: "toolyour-control-plane-start-job", version: "0.1.0" },
  });
  if (!sessionId) throw new Error("no mcp-session-id from initialize");

  const started = toolJson(
    await rpc("tools/call", {
      name: "job_start",
      arguments: arguments_,
    })
  );
  if (started?.error || !started?.jobId) {
    console.error(JSON.stringify(started, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        task: `task-${task}`,
        jobId: started.jobId,
        specHash: started.specHash,
        state: started.state,
        host: `node scripts/control-plane-host.mjs --job ${started.jobId} --cwd experiments/control-plane-fixture`,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
