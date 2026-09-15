/**
 * Infer feature domain from goals for feature-memory matching.
 */

const DOMAIN_PATTERNS: Array<{ domain: string; patterns: RegExp[] }> = [
  {
    domain: "ocr",
    patterns: [/\bocr\b/i, /optical character/i, /text extraction/i, /scan(ned)?\s+(text|image)/i],
  },
  {
    domain: "auth",
    patterns: [/\bauth(entication|orization)?\b/i, /\blogin\b/i, /\bjwt\b/i, /\boauth\b/i, /\bsso\b/i],
  },
  {
    domain: "ship-gate",
    patterns: [
      /ship[\s-]?gate/i,
      /production[\s-]?ready/i,
      /preview deploy/i,
      /pre[\s-]?deploy/i,
    ],
  },
  {
    domain: "seo",
    patterns: [/\bseo\b/i, /meta[\s-]?tags/i, /search engine/i, /sitemap/i, /structured data/i],
  },
  {
    domain: "security",
    patterns: [/\bsecurity\b/i, /\bvulnerability\b/i, /headers analyzer/i, /\btls\b/i, /\bssl\b/i],
  },
  {
    domain: "payments",
    patterns: [/\bpayment/i, /\bstripe\b/i, /\bbilling\b/i, /\bcheckout\b/i],
  },
  {
    domain: "api",
    patterns: [/\brest api\b/i, /\bgraphql\b/i, /api endpoint/i, /webhook/i],
  },
  {
    domain: "converter",
    patterns: [/\bconvert(er)?\b/i, /\bpdf\b/i, /\bdocx\b/i, /\bimage format/i],
  },
];

export function detectFeatureDomain(goal: string, hint?: string): string {
  const text = `${goal} ${hint || ""}`.trim();
  if (!text) return "general";
  for (const { domain, patterns } of DOMAIN_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return domain;
  }
  const token = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .find((t) => t.length > 3);
  return token || "general";
}

export function extractProjectName(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  for (const key of ["projectName", "project", "repo", "workspace"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
  }
  const scope = input.projectScope;
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const s = scope as Record<string, unknown>;
    for (const key of ["projectId", "projectName", "repository"]) {
      const v = s[key];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
    }
  }
  return undefined;
}

/** Prefer repository URL/name from projectScope for memory scoping. */
export function extractRepoHint(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  if (typeof input.repoHint === "string" && input.repoHint.trim()) {
    return input.repoHint.trim().slice(0, 300);
  }
  if (typeof input.repository === "string" && input.repository.trim()) {
    return input.repository.trim().slice(0, 300);
  }
  const scope = input.projectScope;
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const repo = (scope as Record<string, unknown>).repository;
    if (typeof repo === "string" && repo.trim()) return repo.trim().slice(0, 300);
  }
  return undefined;
}

export function extractFeatureRequirements(
  goal: string,
  input?: Record<string, unknown>
): string {
  const fromInput = input?.requirements || input?.featureRequirements;
  if (typeof fromInput === "string" && fromInput.trim()) return fromInput.trim();
  return goal.trim();
}
