#!/usr/bin/env node
/**
 * Offline: append remaining synthesizer fixtures for high playbook coverage.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "tests/eval/synth-fixtures.json");
const fixtures = JSON.parse(fs.readFileSync(file, "utf8"));

function shaped(operationId, toolId, data = {}, title = "Example finding") {
  return {
    status: 200,
    operationId,
    data: {
      schemaVersion: "toolyour.toolResult@1",
      toolId,
      url: "https://example.com",
      data,
      report: {
        summary: { totalScore: 40, grade: "F", topPriorities: [title] },
        findings: [
          {
            title,
            severity: "high",
            whyItMatters: title,
            howToFix: ["Apply the documented fix"],
          },
        ],
      },
    },
  };
}

fixtures["accessibility-audit"] = {
  input: { url: "https://example.com" },
  steps: [
    { id: "imageAlt", operationId: "imageAltTextChecker" },
    { id: "headings", operationId: "headingStructureAnalyzer" },
    { id: "a11y", operationId: "accessibilityAuditor" },
  ],
  stepResults: {
    imageAlt: shaped("imageAltTextChecker", "image-alt-text-checker", {}, "Missing alt on hero image"),
    headings: shaped("headingStructureAnalyzer", "heading-structure-analyzer", {}, "Skipped heading level"),
    a11y: shaped("accessibilityAuditor", "accessibility-auditor", {}, "Low contrast text"),
  },
};

fixtures["website-health-check"] = {
  input: { url: "https://example.com" },
  steps: [{ id: "health", operationId: "websiteHealthChecker" }],
  stepResults: {
    health: shaped("websiteHealthChecker", "website-health-checker", { score: 55 }, "TLS or headers weak"),
  },
};

fixtures["eeat-signals-audit"] = {
  input: { url: "https://example.com" },
  steps: [
    { id: "eeat", operationId: "eeatSignalsChecker" },
    { id: "schema", operationId: "schemaMarkupValidator" },
    { id: "meta", operationId: "metaTagsAnalyzer" },
  ],
  stepResults: {
    eeat: shaped("eeatSignalsChecker", "eeat-signals-checker", {}, "Author byline missing"),
    schema: shaped("schemaMarkupValidator", "schema-markup-validator", {}, "Person schema missing"),
    meta: shaped("metaTagsAnalyzer", "meta-tags-analyzer", {}, "Publisher meta thin"),
  },
};

fixtures["local-seo-audit"] = {
  input: { url: "https://example.com" },
  steps: [
    { id: "local", operationId: "localSeoAuditor" },
    { id: "schema", operationId: "schemaMarkupValidator" },
  ],
  stepResults: {
    local: shaped("localSeoAuditor", "local-seo-auditor", {}, "NAP inconsistent"),
    schema: shaped("schemaMarkupValidator", "schema-markup-validator", {}, "LocalBusiness schema incomplete"),
  },
};

fixtures["mcp-discovery-audit"] = {
  input: { url: "https://example.com" },
  steps: [
    { id: "discovery", operationId: "mcpDiscoveryChecker" },
    { id: "geo", operationId: "geoSeoAuditor" },
  ],
  stepResults: {
    discovery: shaped("mcpDiscoveryChecker", "mcp-discovery-checker", {}, "Missing well-known MCP discovery"),
    geo: shaped("geoSeoAuditor", "geo-seo-auditor", {}, "llms.txt missing"),
  },
};

fixtures["soft-404-audit"] = {
  input: { url: "https://example.com/gone" },
  steps: [
    { id: "soft404", operationId: "soft404Checker" },
    { id: "http", operationId: "httpStatusChecker" },
  ],
  stepResults: {
    soft404: shaped("soft404Checker", "soft-404-checker", {}, "Soft 404 content on 200"),
    http: shaped("httpStatusChecker", "http-status-checker", {}, "Status 200 for empty page"),
  },
};

fixtures["pagination-seo-audit"] = {
  input: { url: "https://example.com/blog?page=2" },
  steps: [
    { id: "pagination", operationId: "paginationSeoChecker" },
    { id: "canonical", operationId: "canonicalUrlChecker" },
  ],
  stepResults: {
    pagination: shaped("paginationSeoChecker", "pagination-seo-checker", {}, "Missing rel next/prev"),
    canonical: shaped("canonicalUrlChecker", "canonical-url-checker", {}, "Canonical collapses all pages"),
  },
};

fixtures["site-icons-audit"] = {
  input: { url: "https://example.com" },
  steps: [{ id: "icons", operationId: "siteIconsChecker" }],
  stepResults: {
    icons: shaped("siteIconsChecker", "site-icons-checker", {}, "Favicon 404"),
  },
};

fixtures["site-agent-readiness"] = {
  input: { url: "https://example.com" },
  steps: [
    { id: "geo", operationId: "geoSeoAuditor" },
    { id: "aiSeo", operationId: "aiSeoChecker" },
    { id: "homepageAio", operationId: "aiOverviewReadinessChecker" },
  ],
  stepResults: {
    geo: shaped("geoSeoAuditor", "geo-seo-auditor", {}, "robots blocks AI bots"),
    aiSeo: shaped("aiSeoChecker", "ai-seo-checker", {}, "Thin entity markup"),
    homepageAio: shaped("aiOverviewReadinessChecker", "ai-overview-readiness-checker", {}, "Homepage lacks answer blocks"),
  },
};

fixtures["campaign-tracking"] = {
  input: {
    url: "https://example.com",
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "launch",
  },
  steps: [
    { id: "utm", operationId: "utmBuilder" },
    { id: "adsUtm", operationId: "adsUtmBuilder" },
    { id: "parse", operationId: "utmParser" },
  ],
  stepResults: {
    utm: shaped("utmBuilder", "utm-builder", {}, "Missing utm_campaign"),
    adsUtm: shaped("adsUtmBuilder", "ads-utm-builder", {}, "Macro not expanded in preview"),
    parse: shaped("utmParser", "utm-parser", {}, "Invalid UTM charset"),
  },
};

fixtures["paid-ads-copy-gate"] = {
  input: { platform: "google-rsa", headlines: ["Too long"], descriptions: ["Short"] },
  steps: [
    { id: "counter", operationId: "adsCopyCounter" },
    { id: "rsa", operationId: "googleAdsRsaPreview" },
  ],
  stepResults: {
    counter: shaped("adsCopyCounter", "ads-copy-counter", {}, "Headline over character limit"),
    rsa: shaped("googleAdsRsaPreview", "google-ads-rsa-preview", {}, "Too few unique headlines"),
  },
};

fixtures["growth-unit-economics"] = {
  input: { spend: 1000, revenue: 2500, clicks: 400, impressions: 20000, conversions: 50 },
  steps: [
    { id: "roas", operationId: "roasCalculator" },
    { id: "cpc", operationId: "cpcCalculator" },
    { id: "ctr", operationId: "ctrCalculator" },
  ],
  stepResults: {
    roas: shaped("roasCalculator", "roas-calculator", { roas: 2.5 }, "ROAS below target"),
    cpc: shaped("cpcCalculator", "cpc-calculator", { cpc: 2.5 }, "CPC elevated"),
    ctr: shaped("ctrCalculator", "ctr-calculator", { ctr: 2 }, "CTR soft"),
  },
};

fixtures["landing-conversion-check"] = {
  input: { url: "https://example.com/pricing" },
  steps: [
    { id: "cta", operationId: "landingPageCtaFinder" },
    { id: "forms", operationId: "formFieldInventory" },
    { id: "tags", operationId: "marketingTagExtractor" },
  ],
  stepResults: {
    cta: shaped("landingPageCtaFinder", "landing-page-cta-finder", {}, "Primary CTA unclear"),
    forms: shaped("formFieldInventory", "form-field-inventory", {}, "Form asks for too many fields"),
    tags: shaped("marketingTagExtractor", "marketing-tag-extractor", {}, "No conversion pixel found"),
  },
};

fixtures["email-campaign-qa"] = {
  input: { subject: "!!!", preheader: "", bodyHtml: "<p>hi</p>" },
  steps: [
    { id: "subject", operationId: "emailSubjectLineTester" },
    { id: "spam", operationId: "emailSpamScore" },
  ],
  stepResults: {
    subject: shaped("emailSubjectLineTester", "email-subject-line-tester", {}, "Subject looks spammy"),
    spam: shaped("emailSpamScore", "email-spam-score", {}, "HTTP links in email"),
  },
};

fixtures["dev-json-pipeline"] = {
  input: { json: "{ bad" },
  steps: [
    { id: "validate", operationId: "jsonValidator" },
    { id: "format", operationId: "jsonFormatter" },
    { id: "zod", operationId: "jsonToZod" },
  ],
  stepResults: {
    validate: shaped("jsonValidator", "json-validator", {}, "Invalid JSON"),
    format: shaped("jsonFormatter", "json-formatter", {}, "Cannot format invalid JSON"),
    zod: shaped("jsonToZod", "json-to-zod", {}, "Schema inference skipped"),
  },
};

fixtures["dev-auth-debug"] = {
  input: { claims: { sub: "user-1" } },
  steps: [
    { id: "generate", operationId: "jwtGenerator" },
    { id: "decode", operationId: "jwtDecoder" },
  ],
  stepResults: {
    generate: shaped("jwtGenerator", "jwt-generator", { token: "aaa.bbb.ccc" }, "Unsigned test token"),
    decode: shaped("jwtDecoder", "jwt-decoder", { warnings: ["alg none"] }, "alg none warning"),
  },
};

fixtures["dev-format-transform"] = {
  input: { yaml: "a: 1", xml: "<root/>" },
  steps: [
    { id: "yaml", operationId: "yamlToJson" },
    { id: "json", operationId: "jsonFormatter" },
    { id: "xml", operationId: "xmlFormatter" },
  ],
  stepResults: {
    yaml: shaped("yamlToJson", "yaml-to-json", {}, "YAML parse warning"),
    json: shaped("jsonFormatter", "json-formatter", {}, "JSON format ok"),
    xml: shaped("xmlFormatter", "xml-formatter", {}, "XML not well-formed"),
  },
};

fs.writeFileSync(file, JSON.stringify(fixtures, null, 2) + "\n");
console.log("fixture keys", Object.keys(fixtures).length);
