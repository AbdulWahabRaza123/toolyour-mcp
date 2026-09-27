import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { createGitHubAppTokenProvider } from "../../dist/github/app-auth.js";

describe("GitHub App authentication", () => {
  it("exchanges a signed app JWT for a short-lived installation token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const calls = [];
    const provider = createGitHubAppTokenProvider({
      appId: "123",
      privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      now: () => Date.parse("2026-09-27T00:00:00.000Z"),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith("/installation")) return new Response(JSON.stringify({ id: 99 }), { status: 200 });
        return new Response(JSON.stringify({ token: "installation-token", expires_at: "2026-09-27T01:00:00.000Z" }), { status: 201 });
      },
    });
    const token = await provider.getInstallationToken({ owner: "acme", repo: "api", number: 1 });
    assert.equal(token, "installation-token");
    assert.equal(calls.length, 2);
    assert.match(calls[0].init.headers.Authorization, /^Bearer ey/);
    assert.equal(JSON.stringify(calls).includes("PRIVATE KEY"), false);
  });
});
