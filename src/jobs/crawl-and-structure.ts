import type { JobReport, SynthesizeJobParams } from "./types";
import {
  extractReport,
  extractUrl,
  findingsFromReport,
  mergeFindings,
  operationIdsFromSteps,
  rankActions,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";

function overallFromScores(scores: Array<number | undefined>): number | undefined {
  const numeric = scores.filter((s): s is number => typeof s === "number");
  if (!numeric.length) return undefined;
  return Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length);
}

function totalScoreFromReport(report: Record<string, unknown> | null): number | undefined {
  if (!report) return undefined;
  const summary = report.summary;
  if (summary && typeof summary === "object") {
    const total = (summary as Record<string, unknown>).totalScore;
    if (typeof total === "number") return total;
  }
  return undefined;
}

/** robots + sitemap + redirects — launch crawl hygiene */
export function synthesizeCrawlReadiness(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const robotsReport = extractReport(stepResults.robots);
  const sitemapReport = extractReport(stepResults.sitemap);
  const redirectReport = extractReport(stepResults.redirects);

  const findings = mergeFindings(
    findingsFromReport(robotsReport, "robots"),
    findingsFromReport(sitemapReport, "sitemap"),
    findingsFromReport(redirectReport, "redirects")
  );

  const robotsScore = totalScoreFromReport(robotsReport);
  const sitemapScore = totalScoreFromReport(sitemapReport);
  const redirectScore = totalScoreFromReport(redirectReport);
  const overall = overallFromScores([robotsScore, sitemapScore, redirectScore]);
  const prioritizedActions = rankActions(findings, 12);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Crawl readiness for ${url} (robots.txt, sitemap, redirects).`
        : "Crawl readiness check complete.",
      high
        ? `${high} high-severity crawl issue${high === 1 ? "" : "s"} — fix before relying on indexation.`
        : "No high-severity crawl blockers in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Re-check after publishing robots/sitemap changes.",
    ],
    scores: {
      overall: {
        label: "Crawl readiness",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      robots: {
        label: "robots.txt",
        value: robotsScore ?? "—",
        status: scoreFromProxy(robotsScore),
      },
      sitemap: {
        label: "Sitemap XML",
        value: sitemapScore ?? "—",
        status: scoreFromProxy(sitemapScore),
      },
      redirects: {
        label: "Redirect chain",
        value: redirectScore ?? "—",
        status: scoreFromProxy(redirectScore),
      },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Does not crawl the full site graph — single-URL robots/sitemap/redirect probes only.",
      "Not a Search Console indexation status check.",
    ],
  };
}

/** schema + meta + social preview tags */
export function synthesizeStructuredDataAudit(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const schemaReport = extractReport(stepResults.schema);
  const metaReport = extractReport(stepResults.meta);
  const socialReport = extractReport(stepResults.social);

  const findings = mergeFindings(
    findingsFromReport(schemaReport, "schema"),
    findingsFromReport(metaReport, "meta"),
    findingsFromReport(socialReport, "socialPreview")
  );

  const schemaScore = totalScoreFromReport(schemaReport);
  const metaScore = totalScoreFromReport(metaReport);
  const socialScore = totalScoreFromReport(socialReport);
  const overall = overallFromScores([schemaScore, metaScore, socialScore]);
  const prioritizedActions = rankActions(findings, 12);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Structured data + meta audit for ${url}.`
        : "Structured data + meta audit complete.",
      high
        ? `${high} high-severity markup issue${high === 1 ? "" : "s"}.`
        : "No high-severity markup issues in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Validate rich-result eligibility in Google tools after shipping schema.",
    ],
    scores: {
      overall: {
        label: "Structured data readiness",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      schema: {
        label: "Schema markup",
        value: schemaScore ?? "—",
        status: scoreFromProxy(schemaScore),
      },
      meta: {
        label: "Meta tags",
        value: metaScore ?? "—",
        status: scoreFromProxy(metaScore),
      },
      social: {
        label: "Social preview tags",
        value: socialScore ?? "—",
        status: scoreFromProxy(socialScore),
      },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Does not guarantee Google rich results — validates markup structure on the live URL.",
      "Social preview does not fetch third-party crawler caches.",
    ],
  };
}

/** AI Overview / GEO structural readiness (not live AIO rank) */
export function synthesizeAiOverviewReadiness(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const report = extractReport(stepResults.aio);
  const payload = unwrapToolPayload(stepResults.aio);
  const findings = findingsFromReport(report, "aiOverview");
  const score = totalScoreFromReport(report);
  const prioritizedActions = rankActions(findings, 10);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `AI Overview readiness (structural) for ${url}.`
        : "AI Overview readiness check complete.",
      high
        ? `${high} high-severity structure gap${high === 1 ? "" : "s"} for extractability.`
        : "No high-severity structural gaps in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "This is not a live AI Overview rank tracker.",
    ],
    scores: {
      overall: {
        label: "AI Overview structural readiness",
        value: score ?? "—",
        status: scoreFromProxy(score),
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      metrics: report?.metrics || payload?.metrics || {},
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Structural heuristics only — does not claim presence in Google AI Overviews.",
      "No live SERP or citation tracking.",
    ],
  };
}

/** Site agent readiness — GEO origin audit + site-wide AI SEO sample + homepage AIO depth */
export function synthesizeSiteAgentReadiness(
  params: SynthesizeJobParams
): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);

  const geoReport = extractReport(stepResults.geo);
  const geoPayload = unwrapToolPayload(stepResults.geo);
  const aiSeoReport = extractReport(stepResults.aiSeo);
  const aiSeoPayload = unwrapToolPayload(stepResults.aiSeo);
  const aioReport = extractReport(stepResults.homepageAio);

  const findings = mergeFindings(
    findingsFromReport(geoReport, "geoSeo"),
    findingsFromReport(aiSeoReport, "aiSeoSite"),
    findingsFromReport(aioReport, "homepageAio")
  );

  const geoScore =
    totalScoreFromReport(geoReport) ??
    (typeof geoPayload?.siteScore === "number" ? geoPayload.siteScore : undefined);
  const aiSeoScore =
    totalScoreFromReport(aiSeoReport) ??
    (typeof aiSeoPayload?.siteScore === "number" ? aiSeoPayload.siteScore : undefined);
  const aioScore = totalScoreFromReport(aioReport);
  const overall = overallFromScores([geoScore, aiSeoScore, aioScore]);
  const prioritizedActions = rankActions(findings, 14);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Site agent readiness for ${url} (GEO origin + AI SEO sample + homepage structure).`
        : "Site agent readiness audit complete.",
      high
        ? `${high} high-severity gap${high === 1 ? "" : "s"} for AI crawlers and citation surfaces.`
        : "No high-severity agent-readiness blockers in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Pair with crawl-readiness if robots/sitemap need a deeper pass.",
    ],
    scores: {
      overall: {
        label: "Site agent readiness",
        value: overall ?? "—",
        status: scoreFromProxy(overall),
      },
      geoSeo: {
        label: "GEO SEO (origin)",
        value: geoScore ?? "—",
        status: scoreFromProxy(geoScore),
      },
      aiSeoSite: {
        label: "AI SEO (site sample)",
        value: aiSeoScore ?? "—",
        status: scoreFromProxy(aiSeoScore),
      },
      homepageAio: {
        label: "Homepage AIO structure",
        value: aioScore ?? "—",
        status: scoreFromProxy(aioScore),
      },
    },
    findings,
    prioritizedActions,
    workstreams: {
      coverage: aiSeoPayload?.coverage || {},
      llmsSummary: geoPayload?.llmsSummary || {},
      discoveryProbes: geoPayload?.discoveryProbes || [],
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Structural readiness for AI crawlers and extractability — not live ChatGPT or AI Overview rank.",
      "AI SEO checker samples up to eight sitemap URLs; very large sites may need bulk URL auditor.",
      "Discovery probes check common paths only — link canonical docs from llms.txt.",
    ],
  };
}

/** Favicon / apple-touch / manifest icons */
export function synthesizeSiteIconsAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const report = extractReport(stepResults.icons);
  const findings = findingsFromReport(report, "siteIcons");
  const score = totalScoreFromReport(report);
  const prioritizedActions = rankActions(findings, 10);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Site icons check for ${url}.` : "Site icons check complete.",
      high
        ? `${high} high-severity icon issue${high === 1 ? "" : "s"}.`
        : "No high-severity icon issues in this pass.",
      prioritizedActions[0]
        ? `Top fix: ${prioritizedActions[0].action}`
        : "Icons look reachable for common browser/PWA entry points.",
    ],
    scores: {
      overall: {
        label: "Site icons",
        value: score ?? "—",
        status: scoreFromProxy(score),
      },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Checks declared link rel icons and common fallbacks — not a full PWA Lighthouse audit.",
    ],
  };
}

function scoreFromPayload(payload: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!payload) return undefined;
  for (const k of keys) {
    if (typeof payload[k] === "number") return payload[k] as number;
  }
  return undefined;
}

export function synthesizeAccessibilityAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const findings = mergeFindings(
    findingsFromReport(extractReport(stepResults.imageAlt), "imageAlt"),
    findingsFromReport(extractReport(stepResults.headings), "headings"),
    findingsFromReport(extractReport(stepResults.a11y), "accessibility")
  );
  const altScore = totalScoreFromReport(extractReport(stepResults.imageAlt));
  const headScore = totalScoreFromReport(extractReport(stepResults.headings));
  const a11yPayload = unwrapToolPayload(stepResults.a11y) as Record<string, unknown> | null;
  const a11yScore =
    totalScoreFromReport(extractReport(stepResults.a11y)) ??
    scoreFromPayload(a11yPayload, ["totalScore", "siteScore"]);
  const overall = overallFromScores([altScore, headScore, a11yScore]);
  const prioritizedActions = rankActions(findings, 12);
  const high = findings.filter((f) => f.severity === "high").length;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Accessibility audit for ${url}.` : "Accessibility audit complete.",
      high ? `${high} high-severity a11y issue${high === 1 ? "" : "s"}.` : "No high-severity issues in this pass.",
      prioritizedActions[0] ? `Top fix: ${prioritizedActions[0].action}` : "Re-test with keyboard and screen reader.",
    ],
    scores: {
      overall: { label: "Accessibility", value: overall ?? "—", status: scoreFromProxy(overall) },
      imageAlt: { label: "Image alt", value: altScore ?? "—", status: scoreFromProxy(altScore) },
      headings: { label: "Headings", value: headScore ?? "—", status: scoreFromProxy(headScore) },
      accessibility: { label: "WCAG HTML", value: a11yScore ?? "—", status: scoreFromProxy(a11yScore) },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Heuristic HTML audit — not axe or Lighthouse.", "No color contrast measurement."],
  };
}

export function synthesizeWebsiteHealthCheck(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const healthPayload = unwrapToolPayload(stepResults.health) as Record<string, unknown> | null;
  const healthReport = extractReport(stepResults.health);
  const findings = mergeFindings(
    findingsFromReport(healthReport, "health"),
    findingsFromReport(extractReport(stepResults.http), "http"),
    findingsFromReport(extractReport(stepResults.robots), "robots"),
    findingsFromReport(extractReport(stepResults.sitemap), "sitemap"),
    findingsFromReport(extractReport(stepResults.tls), "tls"),
    findingsFromReport(extractReport(stepResults.headers), "headers")
  );
  const healthScore =
    totalScoreFromReport(healthReport) ?? scoreFromPayload(healthPayload, ["siteScore", "totalScore"]);
  const httpScore = totalScoreFromReport(extractReport(stepResults.http));
  const robotsScore = totalScoreFromReport(extractReport(stepResults.robots));
  const sitemapScore = totalScoreFromReport(extractReport(stepResults.sitemap));
  const tlsScore = totalScoreFromReport(extractReport(stepResults.tls));
  const headersScore = totalScoreFromReport(extractReport(stepResults.headers));
  const dimScores = [httpScore, robotsScore, sitemapScore, tlsScore, headersScore].filter(
    (s): s is number => typeof s === "number"
  );
  const overall =
    healthScore ??
    (dimScores.length ? Math.round(dimScores.reduce((a, b) => a + b, 0) / dimScores.length) : undefined);
  const prioritizedActions = rankActions(findings, 12);
  const dims = (healthPayload?.dimensions as Array<{ id: string; label: string; score: number }>) || [];

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Website health check for ${url}.` : "Website health check complete.",
      prioritizedActions[0] ? `Top fix: ${prioritizedActions[0].action}` : "Re-run after deploy or cert renewal.",
    ],
    scores: {
      overall: { label: "Site health", value: overall ?? "—", status: scoreFromProxy(overall) },
      ...(dims.length
        ? Object.fromEntries(
            dims.map((d) => [
              d.id,
              { label: d.label, value: d.score, status: scoreFromProxy(d.score) },
            ])
          )
        : {
            http: { label: "HTTP", value: httpScore ?? "—", status: scoreFromProxy(httpScore) },
            robots: { label: "robots.txt", value: robotsScore ?? "—", status: scoreFromProxy(robotsScore) },
            sitemap: { label: "Sitemap", value: sitemapScore ?? "—", status: scoreFromProxy(sitemapScore) },
            tls: { label: "TLS", value: tlsScore ?? "—", status: scoreFromProxy(tlsScore) },
            headers: {
              label: "Security headers",
              value: headersScore ?? "—",
              status: scoreFromProxy(headersScore),
            },
          }),
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Point-in-time diagnostic — not uptime SLA monitoring."],
  };
}

export function synthesizeEeatSignalsAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const eeatPayload = unwrapToolPayload(stepResults.eeat) as Record<string, unknown> | null;
  const findings = mergeFindings(
    findingsFromReport(extractReport(stepResults.eeat), "eeat"),
    findingsFromReport(extractReport(stepResults.schema), "schema"),
    findingsFromReport(extractReport(stepResults.meta), "meta")
  );
  const eeatScore =
    totalScoreFromReport(extractReport(stepResults.eeat)) ?? scoreFromPayload(eeatPayload, ["totalScore"]);
  const schemaScore = totalScoreFromReport(extractReport(stepResults.schema));
  const metaScore = totalScoreFromReport(extractReport(stepResults.meta));
  const overall = overallFromScores([eeatScore, schemaScore, metaScore]);
  const prioritizedActions = rankActions(findings, 12);

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `E-E-A-T signals audit for ${url}.` : "E-E-A-T audit complete.",
      prioritizedActions[0] ? `Top fix: ${prioritizedActions[0].action}` : "Add About/Contact/Privacy in footer.",
    ],
    scores: {
      overall: { label: "E-E-A-T", value: overall ?? "—", status: scoreFromProxy(overall) },
      eeat: { label: "Trust signals", value: eeatScore ?? "—", status: scoreFromProxy(eeatScore) },
      schema: { label: "Schema", value: schemaScore ?? "—", status: scoreFromProxy(schemaScore) },
      meta: { label: "Meta", value: metaScore ?? "—", status: scoreFromProxy(metaScore) },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Observable trust signals — not a Google quality rater score."],
  };
}

export function synthesizeIndexabilityAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const indexPayload = unwrapToolPayload(stepResults.indexability) as Record<string, unknown> | null;
  const indexReport = extractReport(stepResults.indexability);
  const findings = mergeFindings(
    findingsFromReport(indexReport, "indexability"),
    findingsFromReport(extractReport(stepResults.canonical), "canonical"),
    findingsFromReport(extractReport(stepResults.robots), "robots")
  );
  const indexScore =
    totalScoreFromReport(indexReport) ?? scoreFromPayload(indexPayload, ["totalScore"]);
  const canonicalScore = totalScoreFromReport(extractReport(stepResults.canonical));
  const robotsScore = totalScoreFromReport(extractReport(stepResults.robots));
  const overall = overallFromScores([indexScore, canonicalScore, robotsScore]);
  const prioritizedActions = rankActions(findings, 12);
  const dims = (indexPayload?.dimensions as Array<{ id: string; label: string; score: number }>) || [];
  const indexable = indexPayload?.indexable;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Indexability audit for ${url}.` : "Indexability audit complete.",
      typeof indexable === "boolean"
        ? indexable
          ? "URL appears indexable by directive rules."
          : "Blocking directives or robots.txt path rules detected."
        : "",
      prioritizedActions[0] ? `Top fix: ${prioritizedActions[0].action}` : "Confirm in Search Console after fixes.",
    ].filter(Boolean),
    scores: {
      overall: { label: "Indexability", value: overall ?? "—", status: scoreFromProxy(overall) },
      ...(dims.length
        ? Object.fromEntries(
            dims.map((d) => [
              d.id,
              { label: d.label, value: d.score, status: scoreFromProxy(d.score) },
            ])
          )
        : {
            indexability: {
              label: "Indexability",
              value: indexScore ?? "—",
              status: scoreFromProxy(indexScore),
            },
            canonical: {
              label: "Canonical",
              value: canonicalScore ?? "—",
              status: scoreFromProxy(canonicalScore),
            },
            robots: { label: "robots.txt", value: robotsScore ?? "—", status: scoreFromProxy(robotsScore) },
          }),
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Directive-level audit — not live Google Search Console index coverage.",
      "robots.txt path rules are heuristic.",
    ],
  };
}

export function synthesizeLocalSeoAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const localPayload = unwrapToolPayload(stepResults.local) as Record<string, unknown> | null;
  const localReport = extractReport(stepResults.local);
  const findings = mergeFindings(
    findingsFromReport(localReport, "local"),
    findingsFromReport(extractReport(stepResults.schema), "schema")
  );
  const localScore =
    totalScoreFromReport(localReport) ?? scoreFromPayload(localPayload, ["totalScore"]);
  const schemaScore = totalScoreFromReport(extractReport(stepResults.schema));
  const overall = overallFromScores([localScore, schemaScore]);
  const prioritizedActions = rankActions(findings, 12);
  const dims = (localPayload?.dimensions as Array<{ id: string; label: string; score: number }>) || [];

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `Local SEO audit for ${url}.` : "Local SEO audit complete.",
      prioritizedActions[0] ? `Top fix: ${prioritizedActions[0].action}` : "Align NAP with Google Business Profile.",
    ],
    scores: {
      overall: { label: "Local SEO", value: overall ?? "—", status: scoreFromProxy(overall) },
      ...(dims.length
        ? Object.fromEntries(
            dims.map((d) => [
              d.id,
              { label: d.label, value: d.score, status: scoreFromProxy(d.score) },
            ])
          )
        : {
            local: { label: "Local signals", value: localScore ?? "—", status: scoreFromProxy(localScore) },
            schema: { label: "Schema", value: schemaScore ?? "—", status: scoreFromProxy(schemaScore) },
          }),
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "On-page HTML and JSON-LD only — not Google Business Profile or local pack rank.",
    ],
  };
}

export function synthesizeMcpDiscoveryAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const discoveryPayload = unwrapToolPayload(stepResults.discovery) as Record<string, unknown> | null;
  const geoPayload = unwrapToolPayload(stepResults.geo) as Record<string, unknown> | null;
  const findings = mergeFindings(
    findingsFromReport(extractReport(stepResults.discovery), "discovery"),
    findingsFromReport(extractReport(stepResults.geo), "geo")
  );
  const discoveryScore =
    totalScoreFromReport(extractReport(stepResults.discovery)) ??
    scoreFromPayload(discoveryPayload, ["discoveryScore", "totalScore"]);
  const geoScore =
    totalScoreFromReport(extractReport(stepResults.geo)) ??
    scoreFromPayload(geoPayload, ["totalScore", "siteScore"]);
  const overall = overallFromScores([discoveryScore, geoScore]);
  const prioritizedActions = rankActions(findings, 12);
  const probes = (discoveryPayload?.probes as Array<{ label: string; ok: boolean }>) || [];

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url ? `MCP discovery audit for ${url}.` : "MCP discovery audit complete.",
      probes.filter((p) => p.ok).length
        ? `${probes.filter((p) => p.ok).length}/${probes.length} discovery probes reachable.`
        : "No discovery endpoints reachable at default paths.",
      prioritizedActions[0] ? `Top fix: ${prioritizedActions[0].action}` : "Document discovery URLs in llms.txt.",
    ],
    scores: {
      overall: { label: "MCP discovery", value: overall ?? "—", status: scoreFromProxy(overall) },
      discovery: { label: "Well-known probes", value: discoveryScore ?? "—", status: scoreFromProxy(discoveryScore) },
      geo: { label: "GEO origin", value: geoScore ?? "—", status: scoreFromProxy(geoScore) },
    },
    findings,
    prioritizedActions,
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "Fixed probe path list — custom MCP URLs may exist elsewhere.",
      "Not a live MCP handshake or JSON-RPC test.",
    ],
  };
}

export function synthesizeSoft404Audit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const findings = mergeFindings(
    findingsFromReport(extractReport(stepResults.soft404), "soft404"),
    findingsFromReport(extractReport(stepResults.http), "http")
  );
  const softScore = totalScoreFromReport(extractReport(stepResults.soft404));
  const httpScore = totalScoreFromReport(extractReport(stepResults.http));
  const overall = overallFromScores([softScore, httpScore]);
  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [url ? `Soft 404 audit for ${url}.` : "Soft 404 audit complete."],
    scores: {
      overall: { label: "Soft 404", value: overall ?? "—", status: scoreFromProxy(overall) },
      soft404: { label: "Content signals", value: softScore ?? "—", status: scoreFromProxy(softScore) },
      http: { label: "HTTP status", value: httpScore ?? "—", status: scoreFromProxy(httpScore) },
    },
    findings,
    prioritizedActions: rankActions(findings, 10),
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Heuristic soft-404 — not Search Console coverage."],
  };
}

export function synthesizePaginationSeoAudit(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const findings = mergeFindings(
    findingsFromReport(extractReport(stepResults.pagination), "pagination"),
    findingsFromReport(extractReport(stepResults.canonical), "canonical")
  );
  const pagScore = totalScoreFromReport(extractReport(stepResults.pagination));
  const canonScore = totalScoreFromReport(extractReport(stepResults.canonical));
  const overall = overallFromScores([pagScore, canonScore]);
  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [url ? `Pagination SEO audit for ${url}.` : "Pagination SEO audit complete."],
    scores: {
      overall: { label: "Pagination SEO", value: overall ?? "—", status: scoreFromProxy(overall) },
      pagination: { label: "rel next/prev", value: pagScore ?? "—", status: scoreFromProxy(pagScore) },
      canonical: { label: "Canonical", value: canonScore ?? "—", status: scoreFromProxy(canonScore) },
    },
    findings,
    prioritizedActions: rankActions(findings, 10),
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: ["Single-URL head audit — does not crawl full pagination chain."],
  };
}
