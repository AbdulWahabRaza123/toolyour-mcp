import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderDiscoveryError,
  getProviderInvocation,
  getProviderOperation,
  listProviderProjects,
  searchProviderOperations,
} from "../../dist/provider-discovery/store.js";

const original = {
  actionRegistryUrl: process.env.ACTION_REGISTRY_URL,
  internalSecret: process.env.SAAS_INTERNAL_SECRET,
  fetch: globalThis.fetch,
};

function configure(fetchImpl) {
  process.env.ACTION_REGISTRY_URL = "https://saas.example/internal";
  process.env.SAAS_INTERNAL_SECRET = "test-secret";
  globalThis.fetch = fetchImpl;
}

test.afterEach(() => {
  if (original.actionRegistryUrl === undefined) delete process.env.ACTION_REGISTRY_URL;
  else process.env.ACTION_REGISTRY_URL = original.actionRegistryUrl;
  if (original.internalSecret === undefined) delete process.env.SAAS_INTERNAL_SECRET;
  else process.env.SAAS_INTERNAL_SECRET = original.internalSecret;
  globalThis.fetch = original.fetch;
});

test("MCP project discovery requests and accepts only MCP-compatible delivery", async () => {
  let requestedUrl = "";
  configure(async (input) => {
    requestedUrl = String(input);
    return Response.json({ projects: [{ projectId: "project_1", delivery: "both" }], nextCursor: null });
  });
  await listProviderProjects({ userId: "user_1" });
  assert.equal(new URL(requestedUrl).searchParams.get("surface"), "mcp");

  configure(async () => Response.json({ projects: [{ projectId: "project_2", delivery: "api" }] }));
  await assert.rejects(
    listProviderProjects({ userId: "user_1" }),
    (error) => error instanceof ProviderDiscoveryError && error.code === "unavailable",
  );
});

test("MCP operation search and detail fail closed on API-only results", async () => {
  configure(async () => Response.json({ operations: [{ operationId: "read", delivery: "api" }] }));
  await assert.rejects(
    searchProviderOperations({ userId: "user_1", query: "read" }),
    (error) => error instanceof ProviderDiscoveryError && error.code === "unavailable",
  );

  let requestedUrl = "";
  configure(async (input) => {
    requestedUrl = String(input);
    return Response.json({ operation: { operationId: "read", delivery: "mcp" } });
  });
  await getProviderOperation({ userId: "user_1", projectId: "project_1", operationId: "read" });
  assert.equal(new URL(requestedUrl).searchParams.get("surface"), "mcp");
});

test("MCP invocation reads require an MCP-surface intent", async () => {
  let requestedUrl = "";
  configure(async (input) => {
    requestedUrl = String(input);
    return Response.json({ invocation: { invocationId: "pinv_1", surface: "api" } });
  });
  await assert.rejects(
    getProviderInvocation("user_1", "pinv_1"),
    (error) => error instanceof ProviderDiscoveryError && error.code === "not_found",
  );
  assert.equal(new URL(requestedUrl).searchParams.get("surface"), "mcp");
});
