/**
 * Map skill playbooks → executable workflows for run_playbook.
 * Prefer frontmatter workflowId when present; this is the fallback.
 */
export const SKILL_WORKFLOW_MAP: Record<string, string> = {
  "developer-ship-checklist": "developer-ship-checklist-job",
  "seo-site-audit": "full-seo-audit",
  "page-performance": "core-web-vitals-job",
  "social-preview": "social-preview-audit-job",
  "content-quality": "content-quality-audit-job",
  "content-refresh": "content-quality-audit-job",
  "keyword-opportunity-review": "keyword-opportunity-review-job",
  "web-security-audit": "full-security-audit",
  "dns-email-security": "email-auth-security-job",
  "secrets-and-auth-hygiene": "secrets-hygiene-job",
  "seo-deploy-regression": "seo-deploy-regression-job",
  "crawl-analysis": "internal-link-architecture-job",
  "document-pipeline": "document-convert-pipeline",
  "content-ship": "content-ship-local",
  "ship-gate": "ship-gate-job",
  "fix-verify-ship-gate": "ship-gate-job",
  "fix-verify-security-headers": "security-headers-job",
  "fix-verify-social-preview": "social-preview-audit-job",
  "fix-verify-core-web-vitals": "core-web-vitals-job",
  "fix-verify-seo-audit": "full-seo-audit",
  "fix-verify-email-auth": "email-auth-security-job",
};

export function skillWorkflowId(skillId: string): string | undefined {
  return SKILL_WORKFLOW_MAP[skillId];
}
