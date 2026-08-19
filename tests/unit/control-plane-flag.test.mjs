import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolYourMcpServer } from "../../dist/tools/mcp-tools.js";
import {
  CONTROL_PLANE_APPROVAL_TOOLS,
  CONTROL_PLANE_TOOLS,
  FORBIDDEN_EXECUTION_TOOLS,
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

describe("control-plane MCP loops", { concurrency: 1 }, () => {
  const prevAdditive = process.env.CONTROL_PLANE_ADDITIVE;
  const prevExperiment = process.env.CONTROL_PLANE_EXPERIMENT;

  after(() => {
    if (prevAdditive === undefined) delete process.env.CONTROL_PLANE_ADDITIVE;
    else process.env.CONTROL_PLANE_ADDITIVE = prevAdditive;
    if (prevExperiment === undefined) delete process.env.CONTROL_PLANE_EXPERIMENT;
    else process.env.CONTROL_PLANE_EXPERIMENT = prevExperiment;
  });

  function bothLoops(n) {
    for (const t of CORE_TOOLS) assert.equal(n.includes(t), true, t);
    for (const t of CONTROL_PLANE_TOOLS) assert.equal(n.includes(t), true, t);
    for (const t of CONTROL_PLANE_APPROVAL_TOOLS) assert.equal(n.includes(t), true, t);
    assert.equal(
      n.length,
      CORE_TOOLS.length + CONTROL_PLANE_TOOLS.length + CONTROL_PLANE_APPROVAL_TOOLS.length
    );
  }

  it("always registers skill catalog, job tools, and approvals", () => {
    delete process.env.CONTROL_PLANE_ADDITIVE;
    delete process.env.CONTROL_PLANE_EXPERIMENT;
    bothLoops(names(makeServer()));
  });

  it("ignores leftover CONTROL_PLANE_ADDITIVE and CONTROL_PLANE_EXPERIMENT", () => {
    process.env.CONTROL_PLANE_ADDITIVE = "false";
    process.env.CONTROL_PLANE_EXPERIMENT = "true";
    const n = names(makeServer());
    assert.equal(n.includes("plan_task"), true);
    assert.equal(n.includes("job_status"), true);
    bothLoops(n);
  });

  it("never registers a ToolYour-owned shell or sandbox tool", () => {
    const n = names(makeServer());
    for (const t of FORBIDDEN_EXECUTION_TOOLS) {
      assert.equal(n.includes(t), false, t);
    }
  });

  it("instructions route two loops without mixing", () => {
    assert.equal(resolveMcpInstructions(), DEFAULT_MCP_INSTRUCTIONS);
    assert.match(resolveMcpInstructions(), /Pick exactly one/);
    assert.match(resolveMcpInstructions(), /First call plan_task/);
    assert.match(resolveMcpInstructions(), /Do not invent check_submit/);
    assert.match(resolveMcpInstructions(), /Do not call plan_task, solve_task, or verify_task for that jobId/);
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
