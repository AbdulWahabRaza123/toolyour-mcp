import { createServer } from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAuthRequest } from "../lib/auth.js";

async function withServer(fn) {
  const server = createServer(handleAuthRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("requireAuth", () => {
  it("unauthenticated request is 401", async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res.status, 401);
    });
  });

  it("Bearer test is 200", async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Authorization: "Bearer test" },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
    });
  });
});
