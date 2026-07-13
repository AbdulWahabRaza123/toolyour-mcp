import type { JobReport, SynthesizeJobParams } from "./types";
import { synthesizeCoreWebVitals } from "./core-web-vitals";
import { synthesizeFullSeoAudit } from "./full-seo-audit";
import { synthesizeFullSeoOptimization } from "./full-seo-optimization";
import { synthesizeContentQualityAudit } from "./content-quality-audit";
import { synthesizeKeywordOpportunityReview } from "./keyword-opportunity-review";
import { synthesizeInternalLinkArchitecture } from "./internal-link-architecture";
import { synthesizeSocialPreviewAudit } from "./social-preview-audit";
import { synthesizeTechnicalSeoAudit } from "./technical-seo-audit";

const SYNTHESIZERS: Record<string, (params: SynthesizeJobParams) => JobReport> = {
  "full-seo-audit": synthesizeFullSeoAudit,
  "core-web-vitals": synthesizeCoreWebVitals,
  "full-seo-optimization": synthesizeFullSeoOptimization,
  "internal-link-architecture": synthesizeInternalLinkArchitecture,
  "technical-seo-audit": synthesizeTechnicalSeoAudit,
  "social-preview-audit": synthesizeSocialPreviewAudit,
  "content-quality-audit": synthesizeContentQualityAudit,
  "keyword-opportunity-review": synthesizeKeywordOpportunityReview,
};

export function synthesizeJobReport(params: SynthesizeJobParams): JobReport | null {
  const fn = SYNTHESIZERS[params.synthesizerId];
  if (!fn) return null;
  return fn(params);
}

export function listSynthesizerIds(): string[] {
  return Object.keys(SYNTHESIZERS);
}
