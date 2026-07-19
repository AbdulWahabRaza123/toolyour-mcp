import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { synthesizeFullSeoAudit } from "../../dist/jobs/full-seo-audit.js";
import { synthesizeCoreWebVitals } from "../../dist/jobs/core-web-vitals.js";

const seoShaped = {
  status: 200,
  operationId: "seoAnalyze",
  data: {
    schemaVersion: "toolyour.toolResult@1",
    toolId: "seo-audit",
    url: "https://example.com",
    data: { url: "https://example.com", overallScore: 72 },
    report: {
      summary: { totalScore: 72, grade: "C", topPriorities: ["Fix meta description"] },
      findings: [
        {
          title: "Meta description missing",
          severity: "high",
          whyItMatters: "CTR suffers",
          howToFix: ["Add a 120–160 character meta description"],
        },
      ],
    },
  },
};

const speedShaped = {
  status: 200,
  operationId: "pageSpeedAnalyzer",
  data: {
    schemaVersion: "toolyour.toolResult@1",
    toolId: "page-speed-analyzer",
    url: "https://example.com",
    data: { url: "https://example.com", loadTime: 840, suggestions: [] },
    report: {
      summary: { totalScore: 58, grade: "D", topPriorities: ["Likely LCP contributor"] },
      metrics: {
        totalScore: 58,
        proxies: { lcpScore: 45, tbtScore: 60, fcpScore: 55, clsScore: 70 },
        ttfbMs: 840,
      },
      evidence: {
        lcpCandidate: { src: "https://example.com/hero.jpg", bytes: 450000 },
        renderBlockingScripts: [
          { src: "https://example.com/app.js", defer: false, async: false },
        ],
        imagesMissingDimensions: ["https://example.com/card.png"],
        assetOptimizer: {
          compressImages: [
            {
              src: "https://example.com/hero.jpg",
              bytes: 450000,
              reason: "Likely LCP candidate — compress and resize hero",
            },
          ],
          deferScripts: [
            {
              src: "https://example.com/app.js",
              reason: "Render-blocking script without async/defer",
            },
          ],
          fixDimensions: ["https://example.com/card.png"],
          preloadHints: [
            {
              href: "https://example.com/hero.jpg",
              as: "image",
              reason: "Preload likely LCP image candidate",
            },
          ],
        },
      },
      findings: [
        {
          title: "Likely LCP contributor: large image asset",
          severity: "high",
          whyItMatters: "LCP delay",
          howToFix: ["Compress hero image to WebP"],
        },
      ],
    },
  },
};

describe("job synthesizers", () => {
  it("merges full-seo-audit steps into jobReport", () => {
    const report = synthesizeFullSeoAudit({
      synthesizerId: "full-seo-audit",
      workflowId: "full-seo-audit",
      input: { url: "https://example.com" },
      steps: [
        { id: "seo", operationId: "seoAnalyze" },
        { id: "speed", operationId: "pageSpeedAnalyzer" },
      ],
      stepResults: { seo: seoShaped, speed: speedShaped },
    });

    assert.equal(report.schemaVersion, "toolyour.jobReport@1");
    assert.equal(report.url, "https://example.com");
    assert.ok(report.findings.length >= 2);
    assert.ok(report.prioritizedActions.length >= 1);
    assert.equal(report.toolsUsed.includes("seoAnalyze"), true);
    assert.equal(report.toolsUsed.includes("pageSpeedAnalyzer"), true);
    assert.ok(report.steps.seo);
    assert.ok(report.steps.speed);
    assert.ok(report.scores.LCP);
    assert.ok(
      report.prioritizedActions.some((a) => /hero\.jpg|app\.js/i.test(a.action)),
      "full-seo-audit should include asset optimizer actions when speed is weak"
    );
    assert.ok(report.workstreams.assets?.assetOptimizer);
  });

  it("builds core-web-vitals scores by metric", () => {
    const report = synthesizeCoreWebVitals({
      synthesizerId: "core-web-vitals",
      workflowId: "core-web-vitals-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "speed", operationId: "pageSpeedAnalyzer" },
        { id: "seo", operationId: "seoAnalyze" },
      ],
      stepResults: { speed: speedShaped, seo: seoShaped },
    });

    assert.equal(report.scores.LCP.status, "poor");
    assert.equal(report.scores.TTFB.value, "840ms");
    assert.ok(report.limitations?.some((l) => /proxy/i.test(l)));
    assert.ok(report.prioritizedActions[0].action.includes("hero.jpg") || report.prioritizedActions.length > 0);
    assert.ok(
      report.prioritizedActions.some((a) => a.workstream === "assets"),
      "CWV should prioritize assetOptimizer-derived actions"
    );
    assert.equal(
      report.workstreams.assets?.assetOptimizer?.compressImages?.[0]?.src,
      "https://example.com/hero.jpg"
    );
    assert.ok(report.summary.some((s) => /asset|hero|Compress/i.test(s)));
  });

  it("merges full-seo-optimization workstreams", async () => {
    const { synthesizeFullSeoOptimization } = await import("../../dist/jobs/full-seo-optimization.js");
    const contentShaped = {
      status: 200,
      operationId: "contentOptimization",
      data: {
        schemaVersion: "toolyour.toolResult@1",
        toolId: "content-optimization",
        url: "https://example.com",
        data: { title: "Example", wordCount: 120, suggestions: [], keywordDensity: [] },
        report: {
          summary: { totalScore: 55, grade: "F", topPriorities: ["Missing H1 heading"] },
          findings: [
            {
              title: "Missing H1 heading",
              severity: "high",
              whyItMatters: "H1 matters",
              howToFix: ["Add one H1"],
            },
          ],
        },
      },
    };
    const linksShaped = {
      status: 200,
      operationId: "internalLinking",
      data: {
        schemaVersion: "toolyour.toolResult@1",
        toolId: "internal-linking",
        url: "https://example.com",
        data: {
          url: "https://example.com",
          internalLinksCount: 4,
          brokenLinksCount: 1,
          suggestions: [],
          suggestedLinks: [
            {
              from: "https://example.com/",
              to: "https://example.com/about",
              suggestedAnchorText: "About us",
              relevanceScore: 82,
              reason: "Orphan support",
            },
          ],
        },
        report: {
          summary: { totalScore: 70, grade: "C", topPriorities: [] },
          evidence: {
            prioritizedSuggestedLinks: [
              {
                from: "https://example.com/",
                to: "https://example.com/about",
                suggestedAnchorText: "About us",
                relevanceScore: 82,
                reason: "Orphan support",
              },
            ],
          },
        },
      },
    };

    const report = synthesizeFullSeoOptimization({
      synthesizerId: "full-seo-optimization",
      workflowId: "full-seo-optimization-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "seo", operationId: "seoAnalyze" },
        { id: "content", operationId: "contentOptimization" },
        { id: "speed", operationId: "pageSpeedAnalyzer" },
        { id: "links", operationId: "internalLinking" },
        { id: "extract", operationId: "linkExtractor" },
        { id: "social", operationId: "socialMediaIntegration" },
      ],
      stepResults: {
        seo: seoShaped,
        content: contentShaped,
        speed: speedShaped,
        links: linksShaped,
        extract: seoShaped,
        social: seoShaped,
      },
    });

    assert.equal(report.schemaVersion, "toolyour.jobReport@1");
    assert.ok(report.workstreams?.technicalSeo);
    assert.ok(report.workstreams?.contentQuality);
    assert.ok(report.workstreams?.internalLinking);
    assert.ok(Object.keys(report.scores).length >= 4);
    assert.ok(report.prioritizedActions.some((a) => a.workstream === "internalLinking"));
    assert.ok(report.findings.some((f) => f.workstream === "contentQuality"));
  });

  it("builds internal-link-architecture report", async () => {
    const { synthesizeInternalLinkArchitecture } = await import(
      "../../dist/jobs/internal-link-architecture.js"
    );
    const linksShaped = {
      status: 200,
      operationId: "internalLinking",
      data: {
        schemaVersion: "toolyour.toolResult@1",
        toolId: "internal-linking",
        url: "https://example.com",
        data: {
          url: "https://example.com",
          internalLinksCount: 6,
          brokenLinksCount: 1,
          suggestions: [],
          orphanPages: ["https://example.com/orphan"],
          brokenLinks: [
            { from: "https://example.com/", to: "https://example.com/missing", status: 404 },
          ],
          suggestedLinks: [
            {
              from: "https://example.com/",
              to: "https://example.com/orphan",
              suggestedAnchorText: "Orphan page",
              relevanceScore: 90,
              reason: "Discover orphan",
            },
          ],
        },
        report: {
          summary: { totalScore: 65, grade: "D", topPriorities: [] },
          evidence: { prioritizedHubPages: [{ url: "https://example.com/", score: 12, reason: "Hub" }] },
        },
      },
    };

    const report = synthesizeInternalLinkArchitecture({
      synthesizerId: "internal-link-architecture",
      workflowId: "internal-link-architecture-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "graph", operationId: "internalLinking" },
        { id: "hub", operationId: "linkExtractor" },
        { id: "seo", operationId: "seoAnalyze" },
      ],
      stepResults: { graph: linksShaped, hub: seoShaped, seo: seoShaped },
    });

    assert.ok(report.workstreams?.linkGraph);
    assert.ok(report.prioritizedActions.length >= 1);
    assert.ok(report.findings.some((f) => /orphan/i.test(f.title)));
    assert.ok(report.findings.some((f) => /broken/i.test(f.title)));
  });

  it("merges technical-seo-audit workstreams", async () => {
    const { synthesizeTechnicalSeoAudit } = await import("../../dist/jobs/technical-seo-audit.js");
    const report = synthesizeTechnicalSeoAudit({
      synthesizerId: "technical-seo-audit",
      workflowId: "technical-seo-audit-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "seo", operationId: "seoAnalyze" },
        { id: "extract", operationId: "linkExtractor" },
        { id: "speed", operationId: "pageSpeedAnalyzer" },
      ],
      stepResults: { seo: seoShaped, extract: seoShaped, speed: speedShaped },
    });
    assert.ok(report.workstreams?.technicalSeo);
    assert.ok(report.workstreams?.linkProfile);
    assert.ok(report.workstreams?.performance);
    assert.equal(Object.keys(report.workstreams || {}).length, 3);
  });

  it("builds social-preview-audit report", async () => {
    const { synthesizeSocialPreviewAudit } = await import("../../dist/jobs/social-preview-audit.js");
    const socialShaped = {
      status: 200,
      operationId: "socialMediaIntegration",
      data: {
        schemaVersion: "toolyour.toolResult@1",
        toolId: "social-media-integration",
        url: "https://example.com",
        data: {
          url: "https://example.com",
          openGraphTags: { "og:title": "Example" },
          twitterCardTags: {},
          suggestions: [],
        },
        report: {
          summary: { totalScore: 40, grade: "F", topPriorities: ["Missing Open Graph tags"] },
          metrics: { missingOpenGraphCount: 3, missingTwitterCount: 4, suggestionsCount: 2 },
          findings: [
            {
              title: "Missing Open Graph tags",
              severity: "high",
              whyItMatters: "Previews break",
              howToFix: ["Add og:description"],
            },
          ],
        },
      },
    };
    const report = synthesizeSocialPreviewAudit({
      synthesizerId: "social-preview-audit",
      workflowId: "social-preview-audit-job",
      input: { url: "https://example.com" },
      steps: [{ id: "social", operationId: "socialMediaIntegration" }],
      stepResults: { social: socialShaped },
    });
    assert.ok(report.scores.openGraph);
    assert.ok(report.workstreams?.socialPreview);
    assert.ok(report.prioritizedActions.length >= 1);
  });

  it("merges content-quality-audit workstreams", async () => {
    const { synthesizeContentQualityAudit } = await import("../../dist/jobs/content-quality-audit.js");
    const keywordShaped = {
      status: 200,
      operationId: "rankCheckerKeywords",
      data: {
        schemaVersion: "toolyour.toolResult@1",
        toolId: "keyword-checker",
        url: "https://example.com",
        data: { keywords: ["seo", "audit", "tools"] },
        report: {
          summary: { totalScore: 72, grade: "C", topPriorities: [] },
          metrics: { keywordCount: 3, hasH1: true },
          findings: [],
        },
      },
    };
    const report = synthesizeContentQualityAudit({
      synthesizerId: "content-quality-audit",
      workflowId: "content-quality-audit-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "content", operationId: "contentOptimization" },
        { id: "keywords", operationId: "rankCheckerKeywords" },
      ],
      stepResults: {
        content: {
          status: 200,
          operationId: "contentOptimization",
          data: {
            schemaVersion: "toolyour.toolResult@1",
            toolId: "content-optimization",
            url: "https://example.com",
            data: { title: "T", wordCount: 400, suggestions: [], keywordDensity: [] },
            report: {
              summary: { totalScore: 80, grade: "B", topPriorities: [] },
              findings: [],
            },
          },
        },
        keywords: keywordShaped,
      },
    });
    assert.ok(report.workstreams?.contentQuality);
    assert.ok(report.workstreams?.keywordSignals);
  });

  it("builds keyword-opportunity-review actions", async () => {
    const { synthesizeKeywordOpportunityReview } = await import(
      "../../dist/jobs/keyword-opportunity-review.js"
    );
    const report = synthesizeKeywordOpportunityReview({
      synthesizerId: "keyword-opportunity-review",
      workflowId: "keyword-opportunity-review-job",
      input: { url: "https://example.com" },
      steps: [
        { id: "keywords", operationId: "rankCheckerKeywords" },
        { id: "content", operationId: "contentOptimization" },
      ],
      stepResults: {
        keywords: {
          status: 200,
          operationId: "rankCheckerKeywords",
          data: {
            schemaVersion: "toolyour.toolResult@1",
            toolId: "keyword-checker",
            url: "https://example.com",
            data: { keywords: ["seo"] },
            report: {
              summary: { totalScore: 50, grade: "F", topPriorities: [] },
              recommendations: ["Add FAQs for related queries."],
              evidence: { title: "SEO Tools", h1: "Different H1" },
              findings: [],
            },
          },
        },
        content: {
          status: 200,
          operationId: "contentOptimization",
          data: {
            schemaVersion: "toolyour.toolResult@1",
            toolId: "content-optimization",
            url: "https://example.com",
            data: { title: "T", wordCount: 200, suggestions: [], keywordDensity: [] },
            report: { summary: { totalScore: 55, grade: "F", topPriorities: [] }, findings: [] },
          },
        },
      },
    });
    assert.ok(report.prioritizedActions.length >= 2);
    assert.equal(report.scores.topicSignals.status, "poor");
  });

  it("builds seo-deploy-regression from bulk step", async () => {
    const { synthesizeSeoDeployRegression } = await import(
      "../../dist/jobs/seo-deploy-regression.js"
    );
    const bulkShaped = {
      status: 200,
      operationId: "bulkUrlSeoAuditor",
      data: {
        schemaVersion: "toolyour.toolResult@1",
        toolId: "bulk-url-seo-auditor",
        url: "https://example.com/",
        data: {
          url: "https://example.com/",
          results: [
            { url: "https://example.com/about", score: 42, grade: "F", status: 200, issues: ["Missing title"] },
            { url: "https://example.com/", score: 88, grade: "B", status: 200, issues: [] },
          ],
          worstUrls: [
            { url: "https://example.com/about", score: 42, grade: "F", status: 200, issues: ["Missing title"] },
          ],
        },
        report: {
          summary: { totalScore: 65, grade: "D", topPriorities: ["Missing titles"] },
          metrics: { avgScore: 65, minScore: 42, urlCount: 2 },
          findings: [
            {
              title: "1 page(s) missing a title tag",
              severity: "high",
              whyItMatters: "Titles matter",
              howToFix: ["Add a title"],
            },
          ],
        },
      },
    };
    const report = synthesizeSeoDeployRegression({
      synthesizerId: "seo-deploy-regression",
      workflowId: "seo-deploy-regression-job",
      input: { urls: ["https://example.com/", "https://example.com/about"] },
      steps: [{ id: "bulk", operationId: "bulkUrlSeoAuditor" }],
      stepResults: { bulk: bulkShaped },
    });
    assert.equal(report.schemaVersion, "toolyour.jobReport@1");
    assert.equal(report.scores.minScore.value, 42);
    assert.ok(report.workstreams?.bulk?.worstUrls?.length >= 1);
    assert.ok(
      report.prioritizedActions.some((a) => /about|Diff|Re-run bulk/i.test(a.action))
    );
    assert.ok(report.workstreams?.seoDiff?.skipped);
  });

  it("merges seo-deploy-regression bulk + diff steps", async () => {
    const { synthesizeSeoDeployRegression } = await import(
      "../../dist/jobs/seo-deploy-regression.js"
    );
    const report = synthesizeSeoDeployRegression({
      synthesizerId: "seo-deploy-regression",
      workflowId: "seo-deploy-regression-diff-job",
      input: {
        urls: ["https://example.com/"],
        urlA: "https://staging.example.com/",
        urlB: "https://example.com/",
      },
      steps: [
        { id: "bulk", operationId: "bulkUrlSeoAuditor" },
        { id: "diff", operationId: "seoChangeDiff" },
      ],
      stepResults: {
        bulk: {
          status: 200,
          operationId: "bulkUrlSeoAuditor",
          data: {
            schemaVersion: "toolyour.toolResult@1",
            toolId: "bulk-url-seo-auditor",
            url: "https://example.com/",
            data: {
              url: "https://example.com/",
              worstUrls: [
                { url: "https://example.com/", score: 70, grade: "C", issues: ["Missing canonical"] },
              ],
            },
            report: {
              summary: { totalScore: 70, grade: "C", topPriorities: [] },
              metrics: { avgScore: 70, minScore: 70, urlCount: 1 },
              findings: [],
            },
          },
        },
        diff: {
          status: 200,
          operationId: "seoChangeDiff",
          data: {
            schemaVersion: "toolyour.toolResult@1",
            toolId: "seo-change-diff",
            url: "https://staging.example.com/",
            data: { changes: [{ field: "title", before: "A", after: "B" }] },
            report: {
              summary: { totalScore: 55, grade: "F", topPriorities: ["Title changed"] },
              findings: [
                {
                  title: "Title tag changed",
                  severity: "high",
                  whyItMatters: "SERP CTR may shift",
                  howToFix: ["Confirm intentional title change"],
                },
              ],
            },
          },
        },
      },
    });
    assert.ok(report.findings.some((f) => /Title tag changed/i.test(f.title)));
    assert.ok(report.scores.templateDiff);
    assert.equal(report.workstreams?.seoDiff?.skipped, undefined);
  });
});
