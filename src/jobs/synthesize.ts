import type { JobReport, SynthesizeJobParams } from "./types";
import { synthesizeCoreWebVitals } from "./core-web-vitals";
import { synthesizeFullSeoAudit } from "./full-seo-audit";
import { synthesizeFullSeoOptimization } from "./full-seo-optimization";
import { synthesizeContentQualityAudit } from "./content-quality-audit";
import { synthesizeKeywordOpportunityReview } from "./keyword-opportunity-review";
import { synthesizeInternalLinkArchitecture } from "./internal-link-architecture";
import { synthesizeSocialPreviewAudit } from "./social-preview-audit";
import { synthesizeTechnicalSeoAudit } from "./technical-seo-audit";
import { synthesizeSeoDeployRegression } from "./seo-deploy-regression";
import {
  synthesizeFullSecurityAudit,
  synthesizeSecurityHeaders,
} from "./full-security-audit";
import { synthesizeDeveloperShipChecklist } from "./developer-ship-checklist";
import { synthesizeSecretsHygiene } from "./secrets-hygiene";
import { synthesizeEmailAuthSecurity } from "./email-auth-security";
import { synthesizeFrontendSupplyChain } from "./frontend-supply-chain";

const SYNTHESIZERS: Record<string, (params: SynthesizeJobParams) => JobReport> = {
  "full-seo-audit": synthesizeFullSeoAudit,
  "core-web-vitals": synthesizeCoreWebVitals,
  "full-seo-optimization": synthesizeFullSeoOptimization,
  "internal-link-architecture": synthesizeInternalLinkArchitecture,
  "technical-seo-audit": synthesizeTechnicalSeoAudit,
  "social-preview-audit": synthesizeSocialPreviewAudit,
  "content-quality-audit": synthesizeContentQualityAudit,
  "keyword-opportunity-review": synthesizeKeywordOpportunityReview,
  "seo-deploy-regression": synthesizeSeoDeployRegression,
  "full-security-audit": synthesizeFullSecurityAudit,
  "security-headers": synthesizeSecurityHeaders,
  "developer-ship-checklist": synthesizeDeveloperShipChecklist,
  "secrets-hygiene": synthesizeSecretsHygiene,
  "email-auth-security": synthesizeEmailAuthSecurity,
  "frontend-supply-chain": synthesizeFrontendSupplyChain,
};

export function synthesizeJobReport(params: SynthesizeJobParams): JobReport | null {
  const fn = SYNTHESIZERS[params.synthesizerId];
  if (!fn) return null;
  return fn(params);
}

export function listSynthesizerIds(): string[] {
  return Object.keys(SYNTHESIZERS);
}
