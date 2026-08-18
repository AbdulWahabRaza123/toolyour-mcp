import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolYourMcpServer } from "../../dist/tools/mcp-tools.js";
import {
  CONTROL_PLANE_EXPERIMENT_INSTRUCTIONS,
  CONTROL_PLANE_TOOLS,
  DEFAULT_MCP_INSTRUCTIONS,
  FROZEN_TEST_INVENTORY,
  resolveMcpInstructions,
} from "../../dist/control-plane/mcp.js";
import { RegistryLoader } from "../../dist/registry/loader.js";
import { createLogger } from "../../dist/observability/logger.js";

const CORE_TOOLS = [
  "discover_tools",
  "fetch_payload",
  "get_run",
  "get_tool_schema",
  "invoke_tool",
  "list_categories",
  "list_skills",
  "load_skill",
  "plan_task",
  "run_playbook",
  "run_workflow",
  "solve_task",
  "verify_task",
];

function names(server) {
  return Object.keys(server._registeredTools || {}).sort();
}

function makeServer() {
  const registry = new RegistryLoader(createLogger("error"));
  registry.reload(true);
  return createToolYourMcpServer({
    apiKey: "ty_experiment",
    mcpSessionId: "test",
    registry,
    logger: createLogger("error"),
  });
}

describe("control-plane MCP flag", { concurrency: 1 }, () => {
  const prev = process.env.CONTROL_PLANE_EXPERIMENT;

  after(() => {
    if (prev === undefined) delete process.env.CONTROL_PLANE_EXPERIMENT;
    else process.env.CONTROL_PLANE_EXPERIMENT = prev;
  });

  it("flag off: 13 core tools, no job_* tools", () => {
    delete process.env.CONTROL_PLANE_EXPERIMENT;
    const n = names(makeServer());
    assert.deepEqual(n, CORE_TOOLS.slice().sort());
    for (const t of CONTROL_PLANE_TOOLS) {
      assert.equal(n.includes(t), false);
    }
    assert.equal(n.length, 13);
  });

  it("flag on: isolated control-plane tools only (no catalog harness)", () => {
    process.env.CONTROL_PLANE_EXPERIMENT = "true";
    const n = names(makeServer());
    assert.deepEqual(n, [...CONTROL_PLANE_TOOLS].slice().sort());
    for (const t of CORE_TOOLS) assert.equal(n.includes(t), false, t);
    assert.equal(n.length, 4);
  });

  it("flag off instructions still tell agents to call plan_task first", () => {
    delete process.env.CONTROL_PLANE_EXPERIMENT;
    assert.equal(resolveMcpInstructions(), DEFAULT_MCP_INSTRUCTIONS);
    assert.match(resolveMcpInstructions(), /First call plan_task/);
  });

  it("flag on instructions forbid plan_task for coding jobs", () => {
    process.env.CONTROL_PLANE_EXPERIMENT = "true";
    assert.equal(resolveMcpInstructions(), CONTROL_PLANE_EXPERIMENT_INSTRUCTIONS);
    assert.match(resolveMcpInstructions(), /EXPERIMENT MODE/);
    assert.match(resolveMcpInstructions(), /Do not call job_start/);
    assert.match(resolveMcpInstructions(), /node run-checks\.mjs/);
    assert.doesNotMatch(resolveMcpInstructions(), /First call plan_task/);
  });
});

describe("frozen test inventory hashes", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const testsDir = path.join(root, "experiments", "control-plane-fixture", "tests");

  it("allowlisted hashes match fixture files on disk", () => {
    assert.equal(FROZEN_TEST_INVENTORY.length, 5);
    for (const row of FROZEN_TEST_INVENTORY) {
      const buf = fs.readFileSync(path.join(root, "experiments", "control-plane-fixture", row.rel));
      const hex = createHash("sha256").update(buf).digest("hex");
      assert.equal(hex, row.sha256, row.rel);
    }
    assert.ok(fs.existsSync(testsDir));
  });
});
