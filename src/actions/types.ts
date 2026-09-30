/**
 * A provider-neutral contract for work ToolYour may perform.
 *
 * MCP tools are an interface detail. Actions are the durable control-plane
 * primitive used by native ToolYour routes today and customer connectors later.
 */
export type ActionRisk = "read_only" | "draft" | "approval_required" | "irreversible";
export type ActionIdempotency = "safe" | "key_required" | "unsupported";
export type ActionProvider = "toolyour" | "connector" | "local_bridge";

export interface ActionContract {
  id: string;
  version: 1;
  provider: ActionProvider;
  providerRef: string;
  title: string;
  description: string;
  category: string;
  risk: ActionRisk;
  idempotency: ActionIdempotency;
  requiresHumanApproval: boolean;
  evidence: string[];
  completionTest: string;
  rollback: "not_required" | "manual" | "unsupported";
  inputSchemaRef?: string;
}

export type ActionContractValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateActionContract(action: ActionContract): ActionContractValidation {
  if (!/^[-a-z0-9._]+$/i.test(action.id)) return { ok: false, message: "action id is invalid" };
  if (action.version !== 1) return { ok: false, message: "unsupported action contract version" };
  if (!action.title.trim() || !action.description.trim()) return { ok: false, message: "action title and description are required" };
  if (!action.category.trim() || !action.providerRef.trim()) return { ok: false, message: "action category and provider reference are required" };
  if (!action.evidence.length || !action.completionTest.trim()) return { ok: false, message: "action must declare evidence and a completion test" };
  if (action.risk === "read_only" && action.requiresHumanApproval) return { ok: false, message: "read-only actions cannot require approval" };
  if (action.risk !== "read_only" && !action.requiresHumanApproval) return { ok: false, message: "state-changing actions must require approval until explicitly reviewed" };
  return { ok: true };
}
