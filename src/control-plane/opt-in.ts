import type { Logger } from "../observability/logger";
import { validateApiKey } from "../auth/session";
import { useSaasJobsBackend } from "./store-saas";

export type ControlPlaneAccess =
  | { ok: true }
  | { ok: false; code: "unauthorized"; message: string };

function experimentEnabled(): boolean {
  const v = String(process.env.CONTROL_PLANE_EXPERIMENT || "")
    .trim()
    .toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Production-shaped path: durable Mongo jobs + real ty_ keys.
 * File store and CONTROL_PLANE_EXPERIMENT skip validate-key (dummy ty_experiment).
 */
export function requiresControlPlaneOptIn(): boolean {
  if (experimentEnabled()) return false;
  return useSaasJobsBackend();
}

export async function ensureControlPlaneAccess(
  apiKey: string,
  logger: Logger
): Promise<ControlPlaneAccess> {
  if (!requiresControlPlaneOptIn()) return { ok: true };
  try {
    const session = await validateApiKey(apiKey, "", "node", logger);
    if (session.controlPlane !== true) {
      return {
        ok: false,
        code: "unauthorized",
        message: "This API key is not enabled for control-plane jobs.",
      };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error && e.message.trim() ? e.message.trim() : "Unauthorized";
    return { ok: false, code: "unauthorized", message };
  }
}
