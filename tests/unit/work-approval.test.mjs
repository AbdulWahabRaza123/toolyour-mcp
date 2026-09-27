import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { requestWorkApproval } from "../../dist/work-record/approval-store.js";

describe("WorkRecord approval requests", { concurrency: 1 }, () => {
  const previous = { secret: process.env.SAAS_INTERNAL_SECRET, validate: process.env.SAAS_VALIDATE_URL, fetch: globalThis.fetch };
  after(() => {
    if (previous.secret === undefined) delete process.env.SAAS_INTERNAL_SECRET; else process.env.SAAS_INTERNAL_SECRET = previous.secret;
    if (previous.validate === undefined) delete process.env.SAAS_VALIDATE_URL; else process.env.SAAS_VALIDATE_URL = previous.validate;
    globalThis.fetch = previous.fetch;
  });

  it("requests approval against saved evidence without sending credentials", async () => {
    process.env.SAAS_INTERNAL_SECRET = "internal-test-secret";
    process.env.SAAS_VALIDATE_URL = "http://saas.test/internal/validate-key";
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === "POST") return new Response(JSON.stringify({ approval: { approvalId: "apr_123", status: "pending" } }), { status: 201 });
      return new Response(JSON.stringify({ work: { workId: "work_pr_123456", ownerKey: "owner", latest: { evidence: { pullRequest: { headSha: "head" } } } } }), { status: 200 });
    };
    const approval = await requestWorkApproval({ workId: "work_pr_123456", ownerKey: "owner", summary: "Merge after review" });
    assert.equal(approval.status, "pending");
    const request = JSON.parse(calls[1].init.body).request;
    assert.equal(request.workId, "work_pr_123456");
    assert.match(request.evidenceDigest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(request).includes("internal-test-secret"), false);
  });
});
