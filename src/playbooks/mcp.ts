import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Logger } from "../observability/logger";
import { ownerKeyFromApiKey } from "../control-plane/hash";
import { runPlaybook } from "../orchestrator/run-playbook";
import { runWorkflow } from "../workflow/engine";
import { loadSkills } from "../skills/loader";
import { loadWorkflows } from "../workflow/engine";
import type { RegistryLoader } from "../registry/loader";
import { createPlaybookRun, createSavedPlaybook, finishPlaybookRun, getPlaybookRun, getSavedPlaybook, listSavedPlaybooks, SavedPlaybookStoreError, updateSavedPlaybook } from "./store-saas";

type RegisterTool = (server: McpServer, name: string, description: string, schema: Record<string, z.ZodTypeAny>, handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>) => void;
export interface SavedPlaybookMcpContext { apiKey: string; mcpSessionId: string; registry: RegistryLoader; logger: Logger; }
export const SAVED_PLAYBOOK_BETA_TOOLS = ["create_saved_playbook", "list_saved_playbooks", "get_saved_playbook", "update_saved_playbook", "run_saved_playbook", "get_saved_playbook_run"] as const;
export const savedPlaybooksBetaEnabled = () => String(process.env.PLAYBOOKS_BETA || "").trim().toLowerCase() === "true";
const output = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError });
const inputSchema = z.record(z.unknown()).default({});
const definitionSchema = z.object({ execution: z.object({ kind: z.enum(["skill", "workflow"]), id: z.string().min(2).max(120) }), inputDefaults: z.record(z.unknown()).optional(), acceptance: z.array(z.string().min(1).max(500)).max(20).optional() });

function error(e: unknown) { return output({ error: { code: e instanceof SavedPlaybookStoreError && e.message === "not_found" ? "not_found" : "saved_playbook_unavailable", message: e instanceof Error ? e.message : "Saved Playbooks operation failed" } }, true); }
function owned(ctx: SavedPlaybookMcpContext) { return ownerKeyFromApiKey(ctx.apiKey); }
function validTarget(kind: "skill" | "workflow", id: string) { return kind === "skill" ? loadSkills().some((skill) => skill.id === id) : loadWorkflows().some((workflow) => workflow.id === id); }

export function registerSavedPlaybookTools(server: McpServer, registerTool: RegisterTool, ctx: SavedPlaybookMcpContext): void {
  registerTool(server, "create_saved_playbook", "Private beta: save a reusable ToolYour playbook that points to one existing ToolYour skill or workflow. It never runs arbitrary shell commands.", { name: z.string().min(1).max(120), description: z.string().max(2000).optional(), category: z.string().min(1).max(80).optional(), status: z.enum(["draft", "active"]).optional(), definition: definitionSchema }, async (args) => {
    const definition = args.definition as { execution: { kind: "skill" | "workflow"; id: string } }; if (!validTarget(definition.execution.kind, definition.execution.id)) return output({ error: { code: "unknown_execution_target", message: "definition.execution must reference a currently registered ToolYour skill or workflow" } }, true);
    try { return output(await createSavedPlaybook({ ...args, ownerKey: owned(ctx) })); } catch (e) { return error(e); }
  });
  registerTool(server, "list_saved_playbooks", "Private beta, read-only: list your saved ToolYour playbooks. Other users' playbooks are never returned.", { status: z.enum(["draft", "active", "archived"]).optional() }, async (args) => { try { return output(await listSavedPlaybooks(owned(ctx), typeof args.status === "string" ? args.status : undefined)); } catch (e) { return error(e); } });
  registerTool(server, "get_saved_playbook", "Private beta, read-only: get the current immutable version of one of your saved ToolYour playbooks.", { playbookId: z.string().regex(/^pb_[a-f0-9]{32}$/) }, async (args) => { try { return output(await getSavedPlaybook(String(args.playbookId), owned(ctx))); } catch (e) { return error(e); } });
  registerTool(server, "update_saved_playbook", "Private beta: update saved-playbook details or create a new immutable version by supplying definition. Archiving prevents future runs.", { playbookId: z.string().regex(/^pb_[a-f0-9]{32}$/), name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional(), category: z.string().min(1).max(80).optional(), status: z.enum(["draft", "active", "archived"]).optional(), definition: definitionSchema.optional() }, async (args) => {
    const definition = args.definition as { execution: { kind: "skill" | "workflow"; id: string } } | undefined; if (definition && !validTarget(definition.execution.kind, definition.execution.id)) return output({ error: { code: "unknown_execution_target", message: "definition.execution must reference a currently registered ToolYour skill or workflow" } }, true);
    try { return output(await updateSavedPlaybook(String(args.playbookId), { ...args, ownerKey: owned(ctx) })); } catch (e) { return error(e); }
  });
  registerTool(server, "run_saved_playbook", "Private beta: run one active saved ToolYour playbook with merged input, save its receipt, and return the execution result. It reuses only registered ToolYour skills or workflows.", { playbookId: z.string().regex(/^pb_[a-f0-9]{32}$/), input: inputSchema.optional() }, async (args) => {
    try {
      const stored = await getSavedPlaybook(String(args.playbookId), owned(ctx)); const playbook = stored.playbook as Record<string, unknown>; const definition = stored.definition as Record<string, unknown>;
      if (playbook.status !== "active") return output({ error: { code: "playbook_not_active", message: "Only active saved playbooks can run" } }, true);
      const execution = definition.execution as { kind: "skill" | "workflow"; id: string }; if (!validTarget(execution.kind, execution.id)) return output({ error: { code: "execution_target_removed", message: "This saved playbook references a skill or workflow that is no longer registered" } }, true);
      const input = { ...((definition.inputDefaults || {}) as Record<string, unknown>), ...((args.input || {}) as Record<string, unknown>) };
      const created = await createPlaybookRun({ ownerKey: owned(ctx), playbookId: playbook.playbookId, version: definition.version, execution, input }); const run = created.run as Record<string, unknown>;
      try {
        const result = execution.kind === "skill" ? await runPlaybook(execution.id, input, ctx, "compact") : await runWorkflow(execution.id, input, { ...ctx, mcpTool: "run_saved_playbook", workflowId: execution.id });
        const status = (result as { status?: string }).status === "completed" ? "completed" : "partial"; const gate = (result as { loop?: { gate?: unknown } }).loop?.gate; const finished = await finishPlaybookRun(String(run.playbookRunId), { ownerKey: owned(ctx), status, ...(gate === "pass" || gate === "fail" || gate === "unknown" ? { gate } : {}), result: result as Record<string, unknown> });
        return output({ ...finished, savedPlaybook: { playbookId: playbook.playbookId, version: definition.version } }, status === "partial");
      } catch (runError) { await finishPlaybookRun(String(run.playbookRunId), { ownerKey: owned(ctx), status: "failed", result: { error: runError instanceof Error ? runError.message : "execution failed" } }).catch(() => undefined); throw runError; }
    } catch (e) { return error(e); }
  });
  registerTool(server, "get_saved_playbook_run", "Private beta, read-only: get the durable receipt for one of your saved-playbook runs.", { playbookRunId: z.string().regex(/^pbr_[a-f0-9]{32}$/) }, async (args) => { try { return output(await getPlaybookRun(String(args.playbookRunId), owned(ctx))); } catch (e) { return error(e); } });
}
