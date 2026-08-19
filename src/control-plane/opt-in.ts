import type { Logger } from "../observability/logger";
import { validateApiKey } from "../auth/session";
import { useSaasJobsBackend } from "./store-saas";

export type ControlPlaneAccess =
  | { ok: true }
  | { ok: false; code: "unauthorized"; message: string };

/**
 * Durable Mongo jobs + real ty_ keys require ApiKey.controlPlane.
 * File store skips validate-key (local fixture / ty_experiment).
 */
export function requiresControlPlaneOptIn(): boolean {
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
