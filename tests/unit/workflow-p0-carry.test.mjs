import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("workflow P0 carry / pass findings", () => {
  it("isPassOnlyFinding filters clean-bill titles", async () => {
    const { isPassOnlyFinding } = await import("../../dist/jobs/utils.js");
    assert.equal(isPassOnlyFinding("No mixed-content issues detected"), true);
    assert.equal(isPassOnlyFinding("Mixed content: insecure script"), false);
    assert.equal(isPassOnlyFinding("LCP is too slow"), false);
  });

  it("findingsFromReport drops pass-only titles", async () => {
    const { findingsFromReport } = await import("../../dist/jobs/utils.js");
    const out = findingsFromReport(
      {
        findings: [
          {
            severity: "info",
            title: "No mixed-content issues detected",
            whyItMatters: "ok",
            howToFix: [],
          },
          {
            severity: "high",
            title: "HTTP status 500",
            whyItMatters: "down",
            howToFix: ["fix origin"],
          },
        ],
      },
      "mixedContent"
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "HTTP status 500");
  });

  it("secrets synthesizer ignores skipped jwt payload", async () => {
    const { synthesizeSecretsHygiene } = await import(
      "../../dist/jobs/secrets-hygiene.js"
    );
    const report = synthesizeSecretsHygiene({
      workflowId: "secrets-hygiene-job",
      input: { text: "STRIPE_KEY=sk_live_51ABCDEFdeadbeefxxxx" },
      steps: [
        { id: "leak", operationId: "secretLeakScanner" },
        { id: "jwt", operationId: "jwtDecoder" },
      ],
      stepResults: {
        leak: {
          status: 200,
          data: {
            status: true,
            result: {
              matchCount: 1,
              matches: [
                {
                  type: "stripe-key",
                  message: "Looks like a Stripe API key.",
                  line: 1,
                  preview: "sk_l…xxxx",
                },
              ],
            },
          },
        },
        jwt: {
          status: 200,
          skipped: true,
          reason: "no_jwt_in_input",
          data: { status: true, result: { skipped: true, warnings: [] } },
        },
      },
    });
    assert.ok(report.findings.some((f) => f.title === "stripe-key"));
    assert.equal(
      report.findings.filter((f) => f.workstream === "jwt").length,
      0
    );
    assert.equal(report.gatePolicy, "secrets");
  });
});
