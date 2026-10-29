import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearSessionCache,
  exchangeOAuthAccessToken,
  oauthSessionCacheSize,
  validateApiKey,
} from "../../dist/auth/session.js";

const logger = { warn() {}, info() {}, error() {}, debug() {} };

describe("OAuth session cache bounds", () => {
  beforeEach(() => clearSessionCache());

  it("sweeps expired sessions and caps entries during stateless token exchanges", async () => {
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const envNames = [
      "SAAS_VALIDATE_URL",
      "SAAS_OAUTH_EXCHANGE_URL",
      "SAAS_INTERNAL_SECRET",
    ];
    const oldEnv = new Map(envNames.map((name) => [name, process.env[name]]));
    let now = 1_800_000_000_000;
    let validateRequests = 0;

    try {
      process.env.SAAS_VALIDATE_URL = "https://unit.test/validate-key";
      process.env.SAAS_OAUTH_EXCHANGE_URL = "https://unit.test/oauth-session";
      process.env.SAAS_INTERNAL_SECRET = "unit-test-only";
      Date.now = () => now;
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/validate-key")) {
          validateRequests++;
          return new Response(JSON.stringify({ allowed: false }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            allowed: true,
            sessionToken: "session-token",
            userId: "user-1",
            apiKeyId: "key-1",
            subject: "subject-1",
            expiresIn: 60,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      };

      const first = await exchangeOAuthAccessToken("access-token", logger);
      assert.equal(oauthSessionCacheSize(), 1);
      assert.equal(
        (await validateApiKey(first.credential, "mcp/test", "node", logger)).sessionToken,
        "session-token"
      );
      assert.equal(validateRequests, 0);

      // Trigger the periodic sweep after the first short-lived credential expires.
      now += 61_000;
      await exchangeOAuthAccessToken("access-token", logger);
      assert.equal(oauthSessionCacheSize(), 1);
      await assert.rejects(
        validateApiKey(first.credential, "mcp/test", "node", logger),
        /Unauthorized/
      );
      assert.equal(validateRequests, 1);

      // Stateless exchanges use distinct credentials; the cache must stay bounded.
      for (let i = 0; i < 2_001; i++) {
        await exchangeOAuthAccessToken("access-token", logger);
      }
      assert.equal(oauthSessionCacheSize(), 2_000);
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
      for (const [name, value] of oldEnv) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      clearSessionCache();
    }
  });
});
