import { constants } from "../config";
import type { McpTaskDef } from "../contracts";
import {
  fuzzyTokenMatch,
  tokenizeForFuzzy,
} from "../search/fuzzy-search";

export interface TaskMatch {
  task: McpTaskDef;
  score: number;
}

const URL_RE =
  /https?:\/\/[^\s<>"{}|\\^`[\]]+/i;

/** Common SEO/dev synonym expansions applied before scoring. Free, no embeddings. */
const SYNONYM_MAP: Record<string, string[]> = {
  optimisation: ["optimization"],
  optimize: ["optimisation", "optimization"],
  jpeg: ["jpg"],
  jpg: ["jpeg"],
  pagespeed: ["page speed", "page-speed"],
  "page-speed": ["pagespeed", "page speed"],
  cwv: ["core web vitals"],
  "core web vitals": ["cwv"],
  analyse: ["analyze", "analysis"],
  analyze: ["analyse", "analysis"],
  colour: ["color"],
  color: ["colour"],
  og: ["open graph", "social preview"],
  "open graph": ["og", "social preview"],
  "twitter card": ["social preview", "open graph"],
  ssl: ["tls", "certificate"],
  tls: ["ssl", "certificate"],
  https: ["ssl", "tls"],
  "security headers": ["headers analyzer", "http headers"],
  "broken links": ["broken link", "link checker"],
  orphan: ["orphan pages", "internal linking"],
  "docx": ["word", "document"],
  "word doc": ["docx"],
  pdf: ["document"],
  "meta tags": ["meta tag", "seo analyze"],
  "serp": ["search results", "rank"],
  "pii": ["personally identifiable", "scrub"],
  "headline": ["title rewrite", "restructure"],
  jargon: ["simplify", "plain language"],
  "core web": ["core web vitals", "cwv"],
  vitals: ["core web vitals", "cwv"],
  "layout shift": ["cls"],
  "largest contentful": ["lcp"],
  "time to first byte": ["ttfb"],
  cls: ["layout shift", "core web vitals"],
  lcp: ["largest contentful paint", "core web vitals"],
  inp: ["interaction to next paint", "core web vitals"],
  ttfb: ["time to first byte"],
  "open graph tags": ["og", "social preview"],
  "social preview": ["open graph", "twitter card", "og"],
  "security header": ["security headers", "headers analyzer"],
  hsts: ["security headers", "strict transport"],
  "cookie security": ["cookies", "secure cookie"],
  "email auth": ["spf", "dkim", "dmarc"],
  spf: ["email auth", "dmarc"],
  dmarc: ["email auth", "spf"],
  "robots txt": ["robots", "crawler"],
  sitemap: ["xml sitemap", "sitemap validator"],
  "broken link": ["broken links", "link checker"],
  "internal links": ["internal linking", "orphan"],
  "keyword density": ["keywords", "seo analyze"],
  "meta description": ["meta tags", "seo analyze"],
  "convert word": ["docx", "pdf"],
  "word to pdf": ["docx", "pdf"],
};

/** Tokens too short/common to count as substring hits inside larger words. */
const STOP_TOKENS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "on",
  "in",
  "at",
  "is",
  "my",
  "me",
  "vs",
  "or",
  "and",
  "with",
  "from",
  "this",
  "that",
  "page",
  "site",
  "url",
  "web",
  "www",
  "http",
  "https",
  "com",
]);

export function extractUrlFromText(text: string): string | undefined {
  const match = text.match(URL_RE);
  return match?.[0]?.replace(/[.,;:!?)]+$/, "");
}

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi) || [];
  return matches.map((u) => u.replace(/[.,;:!?)]+$/, ""));
}

export function normalizeGoalText(goal: string): string {
  return goal.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Expand goal with synonym tokens so UK/US and short forms match. */
export function expandGoalWithSynonyms(goal: string): string {
  const g = normalizeGoalText(goal);
  const extras: string[] = [];
  for (const [key, values] of Object.entries(SYNONYM_MAP)) {
    if (g.includes(key)) {
      for (const v of values) {
        if (!g.includes(v)) extras.push(v);
      }
    }
  }
  return extras.length ? `${g} ${extras.join(" ")}` : g;
}

function significantTokens(text: string): string[] {
  return tokenizeForFuzzy(text).filter(
    (t) => t.length >= 3 && !STOP_TOKENS.has(t)
  );
}

export function scoreTask(goal: string, task: McpTaskDef): number {
  const g = expandGoalWithSynonyms(goal);
  let score = 0;

  for (const keyword of task.keywords) {
    const k = keyword.toLowerCase().trim();
    if (!k) continue;
    if (g.includes(k)) {
      // Exact phrase / keyword hit — primary signal
      score += k.split(/\s+/).length + 3;
    } else {
      const words = k.split(/\s+/).filter(Boolean);
      if (words.length > 1 && words.every((w) => g.includes(w))) {
        score += words.length + 1;
      } else {
        // Fuzzy token match for typos (e.g. "vitlas" → "vitals")
        const goalTokens = significantTokens(g);
        const keyTokens = significantTokens(k);
        if (keyTokens.length === 0) continue;
        let fuzzyHits = 0;
        for (const kt of keyTokens) {
          if (goalTokens.some((gt) => fuzzyTokenMatch(kt, gt))) fuzzyHits++;
        }
        if (fuzzyHits === keyTokens.length) {
          score += Math.max(2, keyTokens.length + 1);
        } else if (fuzzyHits > 0 && fuzzyHits >= Math.ceil(keyTokens.length / 2)) {
          score += 1;
        }
      }
    }
  }

  if (g.includes(task.title.toLowerCase())) {
    score += 4;
  }

  // Prefer workflows over single tools when both are competitive
  if (task.type === "workflow" && score >= 3) {
    score += 1;
  }

  // Multi-URL goals boost regression/diff style tasks
  const urls = extractUrlsFromText(goal);
  if (urls.length >= 2) {
    const id = task.id.toLowerCase();
    if (id.includes("regression") || id.includes("diff") || id.includes("bulk")) {
      score += 5;
    }
  }

  return score;
}

export function matchTask(
  goal: string,
  tasks: McpTaskDef[],
  minScore = constants.taskMatchMinScore
): TaskMatch | null {
  let best: TaskMatch | null = null;

  for (const task of tasks) {
    const score = scoreTask(goal, task);
    if (score < minScore) continue;
    if (!best || score > best.score) {
      best = { task, score };
    }
  }

  return best;
}

/**
 * True when the best match is strong enough and not ambiguous vs runner-up.
 * Weak or close top-2 → prefer suggest over wrong workflow.
 */
export function isConfidentMatch(
  goal: string,
  tasks: McpTaskDef[],
  match: TaskMatch | null
): boolean {
  if (!match) return false;
  // Strong absolute scores always execute
  if (match.score >= 8) return true;
  if (match.score < constants.taskMatchMinScore + 1) return false;

  const ranked = rankTaskSuggestions(goal, tasks, 2);
  if (ranked.length >= 2) {
    const margin = ranked[0].score - ranked[1].score;
    if (
      ranked[0].task.id === match.task.id &&
      margin < constants.taskMatchAmbiguityMargin &&
      ranked[1].score >= constants.taskMatchMinScore &&
      match.score < 8
    ) {
      return false;
    }
  }
  return true;
}

export function rankTaskSuggestions(
  goal: string,
  tasks: McpTaskDef[],
  limit = 5
): TaskMatch[] {
  return tasks
    .map((task) => ({ task, score: scoreTask(goal, task) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function normalizeTaskInput(
  goal: string,
  input: Record<string, unknown> | undefined,
  required: string[]
): { ok: true; data: Record<string, unknown> } | { ok: false; missing: string[] } {
  const data: Record<string, unknown> = { ...(input || {}) };

  const nested =
    input && typeof input.input === "object" && input.input !== null
      ? (input.input as Record<string, unknown>)
      : null;
  if (nested) {
    Object.assign(data, nested);
    delete data.input;
  }

  if (!data.url) {
    const fromGoal = extractUrlFromText(goal);
    if (fromGoal) data.url = fromGoal;
  }

  // Multi-URL goals: "compare https://a vs https://b"
  const urls = extractUrlsFromText(goal);
  if (urls.length >= 2) {
    if (!data.urlA) data.urlA = urls[0];
    if (!data.urlB) data.urlB = urls[1];
    if (!Array.isArray(data.urls)) data.urls = urls;
  } else if (urls.length === 1 && !data.url) {
    data.url = urls[0];
  }

  const missing = required.filter((key) => {
    const value = data[key];
    if (key === "urls") {
      return !Array.isArray(value) || value.length === 0;
    }
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return { ok: true, data };
}
