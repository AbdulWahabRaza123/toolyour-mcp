import type { JobFinding, JobReport, SynthesizeJobParams } from "./types";
import {
  extractAssetOptimizer,
  extractReport,
  extractUrl,
  operationIdsFromSteps,
  scoreFromProxy,
  unwrapToolPayload,
} from "./utils";

function compressRows(assetOptimizer: Record<string, unknown> | null): Array<{
  src: string;
  reason: string;
}> {
  if (!assetOptimizer) return [];
  const compress = Array.isArray(assetOptimizer.compressImages)
    ? assetOptimizer.compressImages
    : [];
  const rows: Array<{ src: string; reason: string }> = [];
  for (const item of compress) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const src = String(row.src || "").trim();
    if (!src) continue;
    rows.push({
      src,
      reason: String(row.reason || "Compress / serve a modern image format"),
    });
  }
  return rows;
}

function convertDownloadUrl(shaped: unknown): string | undefined {
  const payload = unwrapToolPayload(shaped as Record<string, unknown>);
  if (!payload) return undefined;
  if (typeof payload.downloadUrl === "string") return payload.downloadUrl;
  const result = payload.result;
  if (result && typeof result === "object") {
    const url = (result as { downloadUrl?: unknown }).downloadUrl;
    if (typeof url === "string") return url;
  }
  return undefined;
}

export function synthesizeFrontendWebp(params: SynthesizeJobParams): JobReport {
  const { workflowId, input, steps, stepResults } = params;
  const url = extractUrl(input, stepResults);
  const speedReport = extractReport(stepResults.speed);
  const assetOptimizer = extractAssetOptimizer(speedReport);
  const images = compressRows(assetOptimizer);
  const zipUrl = convertDownloadUrl(stepResults.convert);
  const remaining = images.filter((row) => !/\.webp(\?|$)/i.test(row.src));

  const findings: JobFinding[] = remaining.map((row) => ({
    workstream: "assets",
    severity: /lcp/i.test(row.reason) ? "high" : "medium",
    title: `Convert image to WebP: ${row.src}`,
    whyItMatters:
      "Uncompressed PNG/JPEG assets inflate LCP and transfer size. Serving WebP (with a fallback) is a standard page-speed fix.",
    howToFix: [
      zipUrl
        ? `Download converted WebP from ${zipUrl} and replace the source asset.`
        : "Call convertToWebp with this image URL (or pack URLs via folderToZip, then convert the zip).",
      `Replace <img src> / srcset for ${row.src} with the .webp file (keep a JPEG/PNG fallback via <picture> when needed).`,
      "Re-run verify_task on the same URL after the host commit is deployed.",
    ],
    metric: "LCP",
    evidence: { src: row.src, reason: row.reason, webpZip: zipUrl || null },
  }));

  const overall =
    remaining.length === 0 ? 90 : Math.max(20, 80 - remaining.length * 10);

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: params.jobId || workflowId,
    workflowId,
    url,
    summary: [
      url
        ? `Frontend WebP conversion for ${url}.`
        : "Frontend WebP conversion complete.",
      remaining.length
        ? `${remaining.length} image(s) still need a WebP replacement in the repo.`
        : "No compressible raster images listed on this pass.",
      zipUrl
        ? `Converted WebP zip: ${zipUrl}`
        : remaining.length
          ? "Convert step did not return a zip — invoke convertToWebp with the listed URLs."
          : "Nothing to convert.",
    ],
    scores: {
      overall: {
        label: "WebP asset gate",
        value: overall,
        status: scoreFromProxy(overall),
      },
    },
    findings,
    prioritizedActions: remaining.slice(0, 8).map((row, i) => ({
      rank: i + 1,
      workstream: "assets",
      action: `Replace ${row.src} with a WebP asset (${row.reason})`,
      expectedImpact: /lcp/i.test(row.reason) ? "high" : "medium",
      effort: "medium",
    })),
    workstreams: {
      assets: {
        assetOptimizer,
        convertedZip: zipUrl || null,
        pendingImages: remaining.map((row) => row.src),
      },
    },
    toolsUsed: operationIdsFromSteps(steps),
    steps: stepResults,
    limitations: [
      "MCP converts reachable image URLs; the host agent must commit the WebP files and update img/srcset.",
      "SVG, already-WebP, and blocked hotlinked images are skipped.",
      "assetOptimizer lists are heuristic (image HEAD sizes + HTML attributes), not Lighthouse audits.",
    ],
  };
}
