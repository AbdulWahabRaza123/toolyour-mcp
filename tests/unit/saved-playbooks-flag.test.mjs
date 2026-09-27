import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToolYourMcpServer } from "../../dist/tools/mcp-tools.js";
import { savedPlaybooksBetaEnabled, SAVED_PLAYBOOK_BETA_TOOLS } from "../../dist/playbooks/mcp.js";
import { RegistryLoader } from "../../dist/registry/loader.js";
import { createLogger } from "../../dist/observability/logger.js";

function server(profile = "default") {
  const logger = createLogger("error");
  const registry = new RegistryLoader(logger);
  registry.reload(true);
  return createToolYourMcpServer({ apiKey: "ty_playbook_test", mcpSessionId: "saved-playbooks", registry, logger }, { profile });
}

describe("Saved Playbooks beta MCP surface", { concurrency: 1 }, () => {
  it("is disabled by default", () => {
    const previous = process.env.PLAYBOOKS_BETA;
    delete process.env.PLAYBOOKS_BETA;
    assert.equal(savedPlaybooksBetaEnabled(), false);
    for (const name of SAVED_PLAYBOOK_BETA_TOOLS) assert.equal(server()._registeredTools[name], undefined, name);
    if (previous === undefined) delete process.env.PLAYBOOKS_BETA; else process.env.PLAYBOOKS_BETA = previous;
  });

  it("appears only on the default profile when explicitly enabled", () => {
    const previous = process.env.PLAYBOOKS_BETA;
    process.env.PLAYBOOKS_BETA = "true";
    for (const name of SAVED_PLAYBOOK_BETA_TOOLS) {
      assert.ok(server()._registeredTools[name], name);
      assert.equal(server("chatgpt-public")._registeredTools[name], undefined, name);
    }
    if (previous === undefined) delete process.env.PLAYBOOKS_BETA; else process.env.PLAYBOOKS_BETA = previous;
  });
});
