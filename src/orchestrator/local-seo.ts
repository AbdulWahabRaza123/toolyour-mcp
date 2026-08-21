import * as cheerio from "cheerio";

export interface LocalSeoIssue {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
}

export interface LocalSeoReport {
  mode: "local-html-audit";
  billed: false;
  summary: {
    score: number;
    issueCount: number;
    criticalCount: number;
  };
  page: {
    title?: string;
    description?: string;
    h1: string[];
    canonical?: string;
    lang?: string;
  };
  issues: LocalSeoIssue[];
  nextSteps: string[];
}

function pushIssue(
  issues: LocalSeoIssue[],
  issue: LocalSeoIssue
): void {
  issues.push(issue);
}

export function analyzeLocalHtml(
  html: string,
  options?: { baseUrl?: string; sourceHint?: string }
): LocalSeoReport {
  const $ = cheerio.load(html);
  const issues: LocalSeoIssue[] = [];

  const title = $("title").first().text().trim();
  const description = $('meta[name="description"]').attr("content")?.trim();
  const h1 = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const canonical = $('link[rel="canonical"]').attr("href")?.trim();
  const lang = $("html").attr("lang")?.trim();
  const viewport = $('meta[name="viewport"]').attr("content")?.trim();

  if (!title) {
    pushIssue(issues, {
      severity: "critical",
      category: "title",
      message: "Missing <title> tag",
    });
  } else if (title.length < 30) {
    pushIssue(issues, {
      severity: "warning",
      category: "title",
      message: `Title is short (${title.length} chars) — aim for 30–60 characters`,
    });
  } else if (title.length > 60) {
    pushIssue(issues, {
      severity: "warning",
      category: "title",
      message: `Title may truncate in search results (${title.length} chars)`,
    });
  }

  if (!description) {
    pushIssue(issues, {
      severity: "critical",
      category: "meta",
      message: "Missing meta description",
    });
  } else if (description.length < 70) {
    pushIssue(issues, {
      severity: "warning",
      category: "meta",
      message: `Meta description is short (${description.length} chars)`,
    });
  } else if (description.length > 160) {
    pushIssue(issues, {
      severity: "warning",
      category: "meta",
      message: `Meta description may truncate (${description.length} chars)`,
    });
  }

  if (h1.length === 0) {
    pushIssue(issues, {
      severity: "critical",
      category: "headings",
      message: "No H1 found",
    });
  } else if (h1.length > 1) {
    pushIssue(issues, {
      severity: "warning",
      category: "headings",
      message: `Multiple H1 tags (${h1.length}) — prefer one primary H1`,
    });
  }

  if (!viewport) {
    pushIssue(issues, {
      severity: "warning",
      category: "mobile",
      message: "Missing viewport meta tag",
    });
  }

  if (!lang) {
    pushIssue(issues, {
      severity: "info",
      category: "accessibility",
      message: "Missing lang attribute on <html>",
    });
  }

  let imagesMissingAlt = 0;
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined || alt.trim() === "") {
      imagesMissingAlt += 1;
    }
  });
  if (imagesMissingAlt > 0) {
    pushIssue(issues, {
      severity: "warning",
      category: "images",
      message: `${imagesMissingAlt} image(s) missing alt text`,
    });
  }

  let emptyLinks = 0;
  $("a").each((_, el) => {
    const text = $(el).text().trim();
    const aria = $(el).attr("aria-label")?.trim();
    if (!text && !aria) emptyLinks += 1;
  });
  if (emptyLinks > 0) {
    pushIssue(issues, {
      severity: "warning",
      category: "links",
      message: `${emptyLinks} link(s) without visible text or aria-label`,
    });
  }

  if (!canonical && options?.baseUrl) {
    pushIssue(issues, {
      severity: "info",
      category: "canonical",
      message: "No canonical URL — add one before production",
    });
  }

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDescription = $('meta[property="og:description"]').attr("content");
  if (!ogTitle || !ogDescription) {
    pushIssue(issues, {
      severity: "info",
      category: "social",
      message: "Open Graph title/description not fully set",
    });
  }

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const penalty = issues.reduce((sum, i) => {
    if (i.severity === "critical") return sum + 15;
    if (i.severity === "warning") return sum + 8;
    return sum + 3;
  }, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const nextSteps = [
    "Fix critical and warning issues in your local HTML or templates.",
    "Re-run solve_task with input.html after edits.",
    "For Core Web Vitals / page speed, pass a deployed or tunneled public URL.",
  ];

  if (options?.sourceHint) {
    nextSteps.unshift(`Audited source: ${options.sourceHint}`);
  }

  return {
    mode: "local-html-audit",
    billed: false,
    summary: {
      score,
      issueCount: issues.length,
      criticalCount,
    },
    page: {
      title: title || undefined,
      description: description || undefined,
      h1,
      canonical: canonical || undefined,
      lang: lang || undefined,
    },
    issues,
    nextSteps,
  };
}

/**
 * Turn local HTML SEO into a closable jobReport (verify_task / remainingFixes).
 * No workflowId — decideRunLoop treats remediable reports without a workflow as closable.
 */
export function localSeoToJobReport(
  report: LocalSeoReport,
  opts?: { jobId?: string; goal?: string }
): import("../jobs/types").JobReport {
  const findings = report.issues
    .filter((i) => i.severity !== "info")
    .map((i) => ({
      workstream: i.category || "technicalSeo",
      severity: (i.severity === "critical"
        ? "high"
        : "medium") as import("../jobs/types").JobSeverity,
      title: i.message,
      whyItMatters: i.message,
      howToFix: [
        i.severity === "critical"
          ? `Fix in local HTML/templates: ${i.message}`
          : `Improve in local HTML/templates: ${i.message}`,
      ],
    }));

  const score = report.summary.score;
  // Any critical/warning finding must fail the gate so verify_task can close the loop.
  const status =
    findings.length === 0
      ? "good"
      : report.summary.criticalCount > 0 || score < 60
        ? "poor"
        : "needs_improvement";
  const gateStatus = findings.length > 0 && status === "needs_improvement" ? "poor" : status;

  return {
    schemaVersion: "toolyour.jobReport@1",
    jobId: opts?.jobId || "local-html-seo",
    workflowId: "",
    summary: [
      opts?.goal
        ? `Local HTML SEO review for: ${opts.goal}`
        : "Local HTML SEO review (no public URL).",
      report.summary.criticalCount
        ? `${report.summary.criticalCount} critical issue(s) — fix before deploy.`
        : findings.length
          ? `${findings.length} issue(s) remain in local HTML.`
          : "No critical/warning issues in this local pass.",
      report.nextSteps[0] || "Re-run solve_task with updated input.html after edits.",
    ],
    scores: {
      overall: {
        label: "Local on-page SEO",
        value: score,
        status: gateStatus,
      },
      technicalSeo: {
        label: "On-page SEO",
        value: score,
        status: gateStatus,
      },
    },
    findings,
    prioritizedActions: findings.slice(0, 8).map((f, i) => ({
      rank: i + 1,
      workstream: f.workstream || "technicalSeo",
      action: f.howToFix[0] || f.title,
      expectedImpact: f.severity === "high" ? ("high" as const) : ("medium" as const),
      effort: "medium" as const,
    })),
    toolsUsed: [],
    steps: { local: report },
    limitations: [
      "Local HTML audit only — not a live crawl, CrUX, or Lighthouse lab run.",
      "Pass updated input.html and verify_task with this result as baseline until gate pass.",
    ],
  };
}
