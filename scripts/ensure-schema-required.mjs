#!/usr/bin/env node
/**
 * Ensure high-traffic MCP tool schemas declare `required` fields so
 * invoke_tool / solve_task fail early instead of billing a 4xx from the gateway.
 *
 * Targets: SEO Tools / SEO APIs, Convertors, Documents, Text Utilities / Text Intelligence,
 * plus every operationId used by workflows.json.
 *
 * Usage:
 *   node scripts/ensure-schema-required.mjs
 *   node scripts/ensure-schema-required.mjs --check   # exit 1 if changes needed
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const schemasDir = path.join(root, "registry", "schemas");
const manifestPath = path.join(root, "registry", "manifest.json");
const workflowsPath = path.join(root, "registry", "workflows.json");

const checkOnly = process.argv.includes("--check");

const HIGH_TRAFFIC_CATEGORIES = new Set([
  "SEO Tools",
  "SEO APIs",
  "Convertors",
  "Documents",
  "Text Utilities",
  "Text Intelligence",
  "Office",
  "File Extract",
]);

/** Explicit required fields when category heuristics are not enough. */
const REQUIRED_OVERRIDES = {
  pageSpeedAnalyzer: ["url"],
  seoAnalyze: ["url"],
  contentOptimization: ["url"],
  internalLinking: ["url"],
  linkExtractor: ["url"],
  socialMediaIntegration: ["url"],
  rankCheckerKeywords: ["url"],
  bulkUrlSeoAuditor: ["urls"],
  seoChangeDiff: ["urlA", "urlB"],
  metaTagsAnalyzer: ["url"],
  keywordDensityChecker: ["url"],
  brokenLinkChecker: ["url"],
  robotsTxtTester: ["url"],
  sitemapValidator: ["url"],
  httpStatusChecker: ["url"],
  mixedContentChecker: ["url"],
  securityHeadersAnalyzer: ["url"],
  sslTlsCertificateChecker: ["url"],
  cookieSecurityAnalyzer: ["url"],
  spfDkimDmarcChecker: ["url"],
  dnsLookup: ["url"],
  securityTxtChecker: ["url"],
  headlineRestructurer: ["text"],
  jargonBuster: ["text"],
  snippetMaker: ["text"],
  piiScrub: ["text"],
  aiTextAi: ["text"],
  wordCounter: ["text"],
  caseConverter: ["text"],
  docx_to_pdf: ["file"],
  pdf_to_docx: ["file"],
  convertToJpg: ["image"],
  convertToPng: ["image"],
  convertToWebp: ["urls"],
  folderToZip: ["urls"],
  zipExtract: ["file"],
};

/** Skip auto-required (discovery / no-input / ambiguous tools). */
const SKIP_REQUIRED = new Set([
  "documents_supported_conversions",
  "office_supported_conversions",
  "archive_supported_conversions",
  "ebook_supported_conversions",
  "web_supported_conversions",
  "audio_supported_conversions",
  "video_supported_conversions",
  "dummy_text_generator_post",
]);

function hasUsableRequired(request) {
  if (!request || typeof request !== "object") return false;
  if (Array.isArray(request.required) && request.required.length > 0) return true;
  if (Array.isArray(request.oneOf)) {
    return request.oneOf.some(
      (branch) =>
        branch &&
        typeof branch === "object" &&
        Array.isArray(branch.required) &&
        branch.required.length > 0
    );
  }
  return false;
}

function inferRequired(operationId, tool, request) {
  if (REQUIRED_OVERRIDES[operationId]) return REQUIRED_OVERRIDES[operationId];

  if (tool?.inputShape === "multipart") {
    return [tool.fileField || "file"];
  }

  // Heuristic from existing property names
  const props =
    request && typeof request === "object" && request.properties
      ? Object.keys(request.properties)
      : [];
  if (props.includes("url")) return ["url"];
  if (props.includes("urls")) return ["urls"];
  if (props.includes("text")) return ["text"];
  if (props.includes("file")) return ["file"];
  if (props.includes("urlA") && props.includes("urlB")) return ["urlA", "urlB"];

  // Category defaults
  if (tool?.category === "Convertors" || tool?.category === "Documents") {
    return ["file"];
  }
  if (
    tool?.category === "SEO Tools" ||
    tool?.category === "SEO APIs" ||
    tool?.category === "Security APIs"
  ) {
    return ["url"];
  }
  if (
    tool?.category === "Text Utilities" ||
    tool?.category === "Text Intelligence"
  ) {
    return ["text"];
  }

  return null;
}

function applyRequired(request, required) {
  if (!request || typeof request !== "object") {
    return {
      type: "object",
      required,
      properties: Object.fromEntries(
        required.map((k) => [
          k,
          {
            type: k === "urls" ? "array" : "string",
            description: `Required input: ${k}`,
          },
        ])
      ),
      additionalProperties: true,
      description: "Tool-specific input fields.",
    };
  }

  // oneOf: ensure first (flat) branch has required
  if (Array.isArray(request.oneOf) && request.oneOf.length > 0) {
    const oneOf = request.oneOf.map((branch, i) => {
      if (!branch || typeof branch !== "object") return branch;
      if (i === 0 || !Array.isArray(branch.required) || branch.required.length === 0) {
        const properties = {
          ...(branch.properties || {}),
        };
        for (const key of required) {
          if (!properties[key]) {
            properties[key] = {
              type: key === "urls" ? "array" : "string",
              description: `Required input: ${key}`,
            };
          }
        }
        return {
          ...branch,
          type: branch.type || "object",
          required: [...new Set([...(branch.required || []), ...required])],
          properties,
        };
      }
      return branch;
    });
    return { ...request, oneOf };
  }

  const properties = { ...(request.properties || {}) };
  for (const key of required) {
    if (!properties[key]) {
      properties[key] = {
        type: key === "urls" ? "array" : key === "file" ? "string" : "string",
        ...(key === "file" ? { format: "binary" } : {}),
        description: `Required input: ${key}`,
      };
    }
  }

  return {
    ...request,
    type: request.type || "object",
    required: [...new Set([...(request.required || []), ...required])],
    properties,
    additionalProperties:
      request.additionalProperties === undefined
        ? true
        : request.additionalProperties,
  };
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const workflows = JSON.parse(fs.readFileSync(workflowsPath, "utf8"));

  const toolById = new Map(manifest.tools.map((t) => [t.operationId, t]));
  const routeById = manifest.routes || {};

  const targets = new Set();
  for (const t of manifest.tools) {
    if (HIGH_TRAFFIC_CATEGORIES.has(t.category)) targets.add(t.operationId);
  }
  for (const wf of workflows.workflows || []) {
    for (const step of wf.steps || []) {
      if (step.operationId) targets.add(step.operationId);
    }
  }
  for (const id of Object.keys(REQUIRED_OVERRIDES)) targets.add(id);

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  const changes = [];

  for (const operationId of [...targets].sort()) {
    const schemaPath = path.join(schemasDir, `${operationId}.json`);
    if (!fs.existsSync(schemaPath)) {
      missing++;
      continue;
    }

    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const tool = toolById.get(operationId) || {
      category: routeById[operationId]?.category,
      inputShape: routeById[operationId]?.multipart ? "multipart" : "json",
      fileField: routeById[operationId]?.fileField,
    };

    if (SKIP_REQUIRED.has(operationId) || /supported_conversions/i.test(operationId)) {
      skipped++;
      continue;
    }

    if (hasUsableRequired(schema.request)) {
      skipped++;
      continue;
    }

    const required = inferRequired(operationId, tool, schema.request);
    if (!required || required.length === 0) {
      skipped++;
      continue;
    }

    const nextRequest = applyRequired(schema.request, required);
    const next = { ...schema, request: nextRequest };
    const before = JSON.stringify(schema, null, 2);
    const after = JSON.stringify(next, null, 2);
    if (before === after) {
      skipped++;
      continue;
    }

    changes.push(`${operationId} → required: [${required.join(", ")}]`);
    if (!checkOnly) {
      fs.writeFileSync(schemaPath, after + "\n");
    }
    updated++;
  }

  const verb = checkOnly ? "would update" : "updated";
  console.log(
    `[ensure-schema-required] ${verb} ${updated}, already ok ${skipped}, missing files ${missing}, targets ${targets.size}`
  );
  for (const line of changes.slice(0, 40)) console.log(`  - ${line}`);
  if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`);

  if (checkOnly && updated > 0) process.exit(1);
}

main();
