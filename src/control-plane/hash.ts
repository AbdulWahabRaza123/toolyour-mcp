import { createHash } from "crypto";

/**
 * Canonical JSON: object keys sorted, array order preserved.
 * Pure — no I/O.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

export function ownerKeyFromApiKey(apiKey: string): string {
  return sha256Hex(apiKey);
}
