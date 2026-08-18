import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const HEX32 = /^[0-9a-f]{32,}$/i;

export function secretsDir(): string {
  return (
    process.env.CONTROL_PLANE_SECRETS_DIR ||
    path.join(os.tmpdir(), "toolyour-control-plane")
  );
}

export function runnerNoncePath(jobId: string): string {
  return path.join(secretsDir(), `${jobId}.nonce`);
}

export function envToken(name: string): string {
  return String(process.env[name] || "").trim();
}

export function expectedRunnerToken(): string {
  return envToken("CONTROL_PLANE_RUNNER_TOKEN");
}

export function expectedStartToken(): string {
  return envToken("CONTROL_PLANE_START_TOKEN");
}

export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hashRunnerNonce(nonce: string): string {
  return createHash("sha256").update(String(nonce || ""), "utf8").digest("hex");
}

export function generateSecret(): string {
  return randomBytes(24).toString("hex");
}

export function generateRunnerNonce(): string {
  return randomBytes(32).toString("hex");
}

export function writeRunnerNonce(jobId: string, nonce: string): void {
  const dir = secretsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = runnerNoncePath(jobId);
  fs.writeFileSync(file, nonce, { encoding: "utf8", mode: 0o600 });
}

export function readRunnerNonce(jobId: string): string | null {
  const file = runnerNoncePath(jobId);
  if (!fs.existsSync(file)) return null;
  const nonce = fs.readFileSync(file, "utf8").trim();
  return nonce || null;
}

/** True when a presented value is a configured, matching token. Empty env is never a match. */
export function tokenAccepted(presented: string, expected: string): boolean {
  if (!expected || !presented) return false;
  if (expected.length < 16) return false;
  return tokensEqual(presented, expected);
}

export function nonceAccepted(presented: string, nonceHash: string | undefined): boolean {
  if (!presented || !nonceHash || !HEX32.test(presented)) return false;
  return tokensEqual(hashRunnerNonce(presented), nonceHash);
}

/** HMAC over jobId + treeHash + result identities. Keep in sync with @toolyour/sdk check-run. */
export function submitHmacHex(
  runnerToken: string,
  jobId: string,
  nonce: string,
  treeHash: string,
  results: Array<{ checkId: string; status: string; exitCode: number; fingerprint: string }>
): string {
  const body = JSON.stringify({
    jobId,
    treeHash,
    results: results.map((r) => ({
      checkId: r.checkId,
      status: r.status,
      exitCode: r.exitCode,
      fingerprint: r.fingerprint,
    })),
  });
  return createHmac("sha256", runnerToken)
    .update(`${nonce}\n${body}`, "utf8")
    .digest("hex");
}

const SECRET_KEYS = ["runnerNonce", "runnerNonceHash", "startToken", "runnerToken"];

export function leakSecretKeys(payload: unknown): string[] {
  const raw = JSON.stringify(payload);
  return SECRET_KEYS.filter((k) => new RegExp(`"${k}"\\s*:`).test(raw));
}
