import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import mcpTools from "../../dist/tools/mcp-tools.js";
import registryModule from "../../dist/registry/loader.js";
import loggerModule from "../../dist/observability/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const { TOOL_ANNOTATIONS, createToolYourMcpServer } = mcpTools;
const { RegistryLoader } = registryModule;
const { createLogger } = loggerModule;

describe("manifest contract", () => {
  it("has required stats and routes", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "registry", "manifest.json"), "utf8")
    );
    assert.equal(typeof manifest.schemaVersion, "string");
    assert.ok(Array.isArray(manifest.tools));
    assert.ok(manifest.routes.convertToJpg || manifest.routes.docx_to_pdf);
  });

  it("declares all required ChatGPT safety hints for every MCP tool", () => {
    const expectedTools = [
      "plan_task",
      "recall_context",
      "capture_feature",
      "list_feature_memory",
      "publish_feature_pattern",
      "compare_feature_memory",
      "list_community_patterns",
      "delete_feature",
      "unpublish_feature_pattern",
      "solve_task",
      "run_playbook",
      "verify_task",
      "discover_tools",
      "list_categories",
      "get_tool_schema",
      "invoke_tool",
      "list_skills",
      "load_skill",
      "fetch_payload",
      "get_run",
      "run_workflow",
      "job_start",
      "job_status",
      "check_submit",
      "job_cancel",
      "job_declare_action",
      "job_approve",
      "create_saved_playbook",
      "list_saved_playbooks",
      "get_saved_playbook",
      "update_saved_playbook",
      "run_saved_playbook",
      "get_saved_playbook_run",
    ];

    assert.deepEqual(Object.keys(TOOL_ANNOTATIONS).sort(), expectedTools.sort());
    for (const [name, annotations] of Object.entries(TOOL_ANNOTATIONS)) {
      assert.equal(typeof annotations.readOnlyHint, "boolean", `${name}.readOnlyHint`);
      assert.equal(typeof annotations.openWorldHint, "boolean", `${name}.openWorldHint`);
      assert.equal(typeof annotations.destructiveHint, "boolean", `${name}.destructiveHint`);
    }
  });

  it("publishes the safety hints in every registered tool descriptor", () => {
    const logger = createLogger("error");
    const registry = new RegistryLoader(logger);
    registry.reload(true);
    const server = createToolYourMcpServer({
      apiKey: "ty_contract_test",
      mcpSessionId: "contract-test",
      registry,
      logger,
    });

    for (const [name, annotations] of Object.entries(TOOL_ANNOTATIONS)) {
      if (!server._registeredTools[name]) continue; // private beta tools are correctly absent unless enabled
      assert.deepEqual(server._registeredTools[name]?.annotations, annotations, name);
    }
  });

  it("exposes a reviewer-safe OAuth tool surface for ChatGPT", async () => {
    const logger = createLogger("error");
    const registry = new RegistryLoader(logger);
    registry.reload(true);
    const server = createToolYourMcpServer(
      {
        apiKey: "oauth_contract_test",
        mcpSessionId: "chatgpt-contract-test",
        registry,
        logger,
      },
      { profile: "chatgpt-public" }
    );
    const registered = server._registeredTools;
    const internalTools = [
      "job_start",
      "job_status",
      "check_submit",
      "job_cancel",
      "job_declare_action",
      "job_approve",
    ];

    assert.equal(Object.keys(registered).length, 21);
    for (const name of internalTools) assert.equal(registered[name], undefined, name);
    for (const [name, tool] of Object.entries(registered)) {
      assert.ok(tool.outputSchema, `${name}.outputSchema`);
      assert.deepEqual(tool._meta?.securitySchemes, [
        { type: "oauth2", scopes: ["toolyour:mcp"] },
      ]);
    }

    const listTools = server.server._requestHandlers.get("tools/list");
    assert.ok(listTools, "tools/list handler");
    const response = await listTools({ method: "tools/list", params: {} }, {});
    assert.equal(response.tools.length, 21);
    for (const tool of response.tools) {
      assert.deepEqual(tool.securitySchemes, [
        { type: "oauth2", scopes: ["toolyour:mcp"] },
      ], `${tool.name}.securitySchemes`);
    }
  });
});
