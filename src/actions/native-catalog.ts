import type { McpRegistryManifest, McpToolRoute } from "../contracts";
import type { ActionContract } from "./types";
import { validateActionContract } from "./types";

/**
 * Compiles the legacy API registry into action contracts without changing its
 * public MCP surface. Non-GET routes are intentionally approval-gated until a
 * reviewed connector/native policy explicitly relaxes them.
 */
function actionFromRoute(route: McpToolRoute): ActionContract {
  const isReadOnly = route.method.trim().toUpperCase() === "GET";
  return {
    id: `toolyour.native.${route.operationId}`,
    version: 1,
    provider: "toolyour",
    providerRef: route.operationId,
    title: route.name,
    description: route.description,
    category: route.category,
    risk: isReadOnly ? "read_only" : "approval_required",
    idempotency: isReadOnly ? "safe" : "key_required",
    requiresHumanApproval: !isReadOnly,
    evidence: ["gateway_receipt", "normalized_result"],
    completionTest: "The gateway returns a successful normalized result.",
    rollback: isReadOnly ? "not_required" : "manual",
    inputSchemaRef: `registry/schemas/${route.operationId}.json`,
  };
}

export function compileNativeActionCatalog(manifest: McpRegistryManifest): ActionContract[] {
  const actions = Object.values(manifest.routes)
    .map(actionFromRoute)
    .sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) throw new Error(`Duplicate action id: ${action.id}`);
    ids.add(action.id);
    const validation = validateActionContract(action);
    if (!validation.ok) throw new Error(`Invalid action contract ${action.id}: ${validation.message}`);
  }
  return actions;
}
