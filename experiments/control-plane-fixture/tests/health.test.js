import { createServer } from "node:http";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../lib/health.js";

describe("health endpoint", () => {
  let server;
  after(() => server?.close());

  it("GET /health returns 200 and { ok: true }", async () => {
    server = createServer(handleRequest);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true });
  });
});
