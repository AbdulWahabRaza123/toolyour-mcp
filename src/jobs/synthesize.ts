import type { JobReport, SynthesizeJobParams } from "./types";
import { finalizeJobReport } from "./utils";
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
import {
  synthesizeAiOverviewReadiness,
  synthesizeCrawlReadiness,
  synthesizeSiteAgentReadiness,
  synthesizeSiteIconsAudit,
  synthesizeStructuredDataAudit,
  synthesizeAccessibilityAudit,
  synthesizeWebsiteHealthCheck,
  synthesizeEeatSignalsAudit,
  synthesizeIndexabilityAudit,
  synthesizeLocalSeoAudit,
  synthesizeMcpDiscoveryAudit,
  synthesizeSoft404Audit,
  synthesizePaginationSeoAudit,
} from "./crawl-and-structure";
import {
  synthesizeCampaignTracking,
  synthesizeEmailCampaignQa,
  synthesizeGrowthUnitEconomics,
  synthesizeLandingConversionCheck,
  synthesizePaidAdsCopyGate,
} from "./marketing-jobs";
import {
  synthesizeDevAuthDebug,
  synthesizeDevFormatTransform,
  synthesizeDevJsonPipeline,
} from "./developer-jobs";
import { synthesizeFrontendWebp } from "./frontend-webp";

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
  "crawl-readiness": synthesizeCrawlReadiness,
  "structured-data-audit": synthesizeStructuredDataAudit,
  "ai-overview-readiness": synthesizeAiOverviewReadiness,
  "site-agent-readiness": synthesizeSiteAgentReadiness,
  "accessibility-audit": synthesizeAccessibilityAudit,
  "website-health-check": synthesizeWebsiteHealthCheck,
  "indexability-audit": synthesizeIndexabilityAudit,
  "local-seo-audit": synthesizeLocalSeoAudit,
  "mcp-discovery-audit": synthesizeMcpDiscoveryAudit,
  "soft-404-audit": synthesizeSoft404Audit,
  "pagination-seo-audit": synthesizePaginationSeoAudit,
  "eeat-signals-audit": synthesizeEeatSignalsAudit,
  "site-icons-audit": synthesizeSiteIconsAudit,
  "campaign-tracking": synthesizeCampaignTracking,
  "paid-ads-copy-gate": synthesizePaidAdsCopyGate,
  "growth-unit-economics": synthesizeGrowthUnitEconomics,
  "email-campaign-qa": synthesizeEmailCampaignQa,
  "landing-conversion-check": synthesizeLandingConversionCheck,
  "dev-json-pipeline": synthesizeDevJsonPipeline,
  "dev-auth-debug": synthesizeDevAuthDebug,
  "dev-format-transform": synthesizeDevFormatTransform,
  "frontend-webp": synthesizeFrontendWebp,
};

export function synthesizeJobReport(params: SynthesizeJobParams): JobReport | null {
  const fn = SYNTHESIZERS[params.synthesizerId];
  if (!fn) return null;
  return finalizeJobReport(fn(params));
}

export function listSynthesizerIds(): string[] {
  return Object.keys(SYNTHESIZERS);
}
