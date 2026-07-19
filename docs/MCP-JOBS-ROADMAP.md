# MCP Jobs Roadmap

**Status:** Planning (execution starts with Phase 0)  
**Owner:** Platform / MCP  
**Last updated:** 2026-07-10

## Purpose

ToolYour MCP should optimize for **jobs** (outcomes agents can act on), not raw tool invocation. A job maps a natural-language goal to a **workflow** (one or more API tools) plus a **synthesized report** the LLM can reason over.

**Canonical agent path (today):** `solve_task` → workflow | tool | local bridge | `suggest`  
**Target:** `solve_task` → job workflow → **synthesized job report** (all step outputs merged by metric/workstream)

This document is the execution plan. Coupling rules: [`docs/PLATFORM-COUPLING.md`](../../docs/PLATFORM-COUPLING.md), [`.cursor/rules/mcp-surface-sync.mdc`](../../.cursor/rules/mcp-surface-sync.mdc).

---

## Principles

1. **Job-first** — Users/agents ask for outcomes (“fix Core Web Vitals”, “optimize SEO”), not `operationId`s.
2. **Synthesis required** — Multi-step workflows must return a merged report, not only the last step.
3. **Upgrade before invent** — Deepen existing SEO APIs before adding parallel tools.
4. **Build tools for gaps** — New tools only when a job repeatedly fails for missing capability.
5. **Same quota story** — One API key, shared REST+MCP quota; document step billing clearly.
6. **No catalog slug changes** — Jobs/workflows do not rename tool slugs or public URLs.

---

## Current baseline (status)

| Area | Today | Notes |
|------|-------|-------|
| Tasks | Expanded in `registry/tasks.json` | Keyword match → workflow / tool / local |
| Workflows | Flagship jobs in `registry/workflows.json` | Most multi-step jobs have synthesizers |
| Workflow engine | `src/workflow/engine.ts` | Returns `stepResults` + optional `jobReport` via synthesizer |
| Skills | Playbooks in `skills/` | `page-performance` → `core-web-vitals-job` |
| `pageSpeedAnalyzer` | Proxy LCP/TBT/FCP/CLS + **`evidence.assetOptimizer`** | Compress/defer/dimension/preload URL lists for agents; still not CrUX field CWV |
| Synthesizers | Phase 0 shipped (`src/jobs/*`) | CWV / full SEO / internal-link consume asset + link priorities |
| `contentOptimization` | Word count, title/meta, readability | Further intent/structure depth still open |
| Summarize | 8KB threshold in `summarize/registry.ts` | Large SEO payloads may truncate before synthesis |

**Phase 0 (workflow + synthesizer infrastructure): shipped.** Asset optimizer hints live **inside** `pageSpeedAnalyzer` — no separate `pageAssetOptimizer` operationId.

---

## Target architecture

```text
solve_task(goal, input)
  → matchTask (tasks.json keywords)
  → runWorkflow (workflows.json steps, shared url input)
  → synthesizeJobReport (NEW: per-job merger)
  → JobReport JSON (stable schema)
```

### Job report schema (`toolyour.jobReport@1`)

All flagship jobs return this envelope:

```typescript
interface JobReport {
  schemaVersion: "toolyour.jobReport@1";
  jobId: string;
  workflowId: string;
  url?: string;
  summary: string[];                    // 3–5 bullets
  scores: Record<string, JobScore>;     // job-specific keys
  findings: JobFinding[];                 // flat, severity-sorted
  prioritizedActions: PrioritizedAction[]; // rank 1..n
  workstreams?: Record<string, unknown>;  // optional grouped view
  toolsUsed: string[];                  // operationIds
  steps: Record<string, unknown>;         // shaped per-step outputs (for drill-down)
  limitations?: string[];               // e.g. "proxy metrics, not CrUX field data"
}

interface JobScore {
  label: string;
  value: string | number;
  status: "good" | "needs_improvement" | "poor" | "unknown";
  primaryCause?: string;
}

interface JobFinding {
  workstream?: string;   // e.g. "LCP", "content", "links"
  severity: "low" | "medium" | "high";
  title: string;
  whyItMatters: string;
  howToFix: string[];
  evidence?: Record<string, unknown>;
  metric?: string;       // LCP | TTFB | INP | CLS | ...
}

interface PrioritizedAction {
  rank: number;
  workstream: string;
  action: string;
  expectedImpact: "high" | "medium" | "low";
  effort?: "low" | "medium" | "high";
}
```

---

## Phase 0 — Workflow infrastructure (Week 1–2)

**Goal:** Multi-tool workflows produce one agent-ready object.

### 0.1 Workflow engine changes

| Task | File | Acceptance |
|------|------|------------|
| Return all `stepResults` on completed runs | `src/workflow/engine.ts` | `execution.steps.seo` and `execution.steps.speed` both present |
| Add optional `synthesizer` on workflow def | `src/contracts/types.ts`, `registry/workflows.json` | `"synthesizer": "core-web-vitals"` |
| Call synthesizer after steps | `src/workflow/engine.ts` | `execution.jobReport` populated when synthesizer set |
| Pass full steps to `solve_task` response | `src/orchestrator/solve-task.ts` | Agent sees `jobReport`, not only last tool |

**Workflow def extension:**

```json
{
  "id": "core-web-vitals-job",
  "title": "Improve Core Web Vitals",
  "description": "Diagnose LCP, TTFB, INP/TBT, CLS with prioritized fixes.",
  "synthesizer": "core-web-vitals",
  "steps": [
    { "id": "speed", "operationId": "pageSpeedAnalyzer" },
    { "id": "seo", "operationId": "seoAnalyze" },
    { "id": "social", "operationId": "socialMediaIntegration" }
  ]
}
```

### 0.2 Job synthesizer module (new)

```
toolyour-mcp/src/jobs/
  types.ts              # JobReport types
  synthesize.ts         # dispatch by synthesizer id
  core-web-vitals.ts
  full-seo-optimization.ts
  internal-link-architecture.ts
  utils.ts              # merge findings, rank actions, dedupe
```

**Ranking heuristic (shared):**

1. Severity: high → medium → low  
2. Metric/workstream with worst `status`  
3. De-duplicate similar `howToFix` strings  
4. Cap `prioritizedActions` at 10  

### 0.3 Tests & eval harness

| File | Content |
|------|---------|
| `tests/unit/workflow-engine.test.mjs` | Multi-step returns all steps |
| `tests/unit/job-synthesizers.test.mjs` | Golden fixtures per job |
| `tests/eval/goals.jsonl` | `{ goal, expectedJobId, requiredFields[] }` |

**Phase 0 exit:** `full-seo-audit` returns merged report with both SEO and speed findings.

---

## Phase 1 — Job: Improve Core Web Vitals (Week 3–4)

### Task registration (`registry/tasks.json`)

```json
{
  "id": "improve-core-web-vitals",
  "title": "Improve Core Web Vitals",
  "description": "Identify LCP, TTFB, INP/TBT, and CLS issues with prioritized fixes.",
  "keywords": [
    "core web vitals", "cwv", "lcp", "cls", "inp", "ttfb",
    "largest contentful paint", "cumulative layout shift",
    "interaction to next paint", "page speed", "pagespeed",
    "fix performance", "improve performance", "speed up page"
  ],
  "type": "workflow",
  "target": "core-web-vitals-job",
  "requiredInput": ["url"]
}
```

### Workflow: `core-web-vitals-job`

| Step | operationId | Contributes |
|------|-------------|-------------|
| speed | `pageSpeedAnalyzer` | LCP candidate, TBT proxy, CLS risks, render-blocking JS/CSS |
| seo | `seoAnalyze` | Resource hints, indexability, heavy markup patterns |
| social | `socialMediaIntegration` | OG image (often LCP), preview weight |

### Synthesizer: `core-web-vitals.ts`

**Scores output:**

| Key | Source | Notes |
|-----|--------|-------|
| `overall` | `pageSpeed.report.summary.totalScore` | Proxy, not Lighthouse |
| `LCP` | `metrics.proxies.lcpScore` + LCP findings | Include LCP element URL if known |
| `TTFB` | **NEW** `metrics.ttfbMs` from API upgrade | Server response time |
| `INP` | `metrics.proxies.tbtScore` | Label as **TBT proxy for INP risk** until CrUX |
| `CLS` | `metrics.proxies.clsScore` + dimensionless images |

**`limitations` array must include:**

- "Scores are HTML-based proxies unless CrUX integration is enabled."
- "INP shown as Total Blocking Time proxy."

### API upgrades (`toolyour-apis`)

| Change | File | Detail |
|--------|------|--------|
| Measure TTFB | `seo-apis.service.ts` `pageSpeedAnalyzer` | From fetch timing / `Server-Timing` if present |
| Metric-first report | `types/seo/page-speed-analyzer.zod.ts` | Add `metrics.ttfbMs`, `metrics.inpProxyLabel` |
| Finding tags | findings[] | Add `metric: "LCP" \| "TTFB" \| "INP" \| "CLS"` |

### Skill update

- `skills/page-performance.md` → point to `improve-core-web-vitals` / `core-web-vitals-job`
- Remove reference to `page-performance-audit`

### Phase 1 exit criteria

- [ ] `solve_task("fix core web vitals for https://…")` → `completed` + `jobReport.scores.LCP` etc.
- [ ] ≥3 `prioritizedActions` with metric tags
- [ ] Eval: 10 CWV goals pass schema validation

### Future (Phase 1b — optional)

| New tool | API | When |
|----------|-----|------|
| `coreWebVitalsFieldData` | CrUX or PageSpeed Insights API | After proxy job stable; env-gated API key |

---

## Phase 2 — Job: Full SEO Optimization (Week 5–6)

Replaces weak `content-optimization` workflow (single step).

### Task: `full-seo-optimization`

**Keywords:** optimize seo, improve seo, seo optimization, on-page seo, rank higher, fix seo issues

**Workflow:** `full-seo-optimization-job`

| Step | operationId | Workstream |
|------|-------------|------------|
| seo | `seoAnalyze` | Technical SEO |
| content | `contentOptimization` | Content quality |
| speed | `pageSpeedAnalyzer` | Performance |
| links | `internalLinking` | Internal linking |
| extract | `linkExtractor` | Link profile |
| social | `socialMediaIntegration` | Social preview |

**Synthesizer:** `full-seo-optimization.ts`

**Workstreams in output:**

1. `technicalSeo` — from seoAnalyze  
2. `contentQuality` — from contentOptimization  
3. `performance` — from pageSpeed (link to CWV job if poor)  
4. `internalLinking` — orphans, broken links, top `suggestedLinks`  
5. `socialPreview` — OG/Twitter gaps  

### API upgrades (priority)

#### `contentOptimization` → v2 report

Add findings for:

| Check | Severity logic |
|-------|----------------|
| H1 missing / multiple H1 | high |
| Heading hierarchy skips (H1→H3) | medium |
| Thin content (&lt;300 words) | high (exists) |
| Title/meta length | medium (exists) |
| Keyword stuffing (&gt;2.5% density) | medium (exists) |
| No internal links in body | medium |
| Readability (avg sentence length) | low/medium |

Files: `seo-apis.service.ts`, `content-optimization.zod.ts`

#### `internalLinking` → agent prioritization

- Return top 10 `suggestedLinks` sorted by `relevanceScore`
- Add `prioritizedHubPages` from existing `graph.hubPages`
- Surface `brokenLinks` count in summary

Files: `seo-apis.service.ts`, `internal-linking.zod.ts`

### Deprecation path

- Keep task id `content-optimization` as alias keywords → `full-seo-optimization-job`
- Update `tasks.json` target for existing `content-optimization` task

### Phase 2 exit criteria

- [ ] Single job returns ≥4 workstreams with scores
- [ ] Content findings include heading structure
- [ ] Internal linking returns ≥5 concrete `from → to` suggestions when crawl succeeds

---

## Phase 3 — Job: Internal Link Architecture (Week 7)

### Task: `internal-link-architecture`

**Keywords:** internal links, orphan pages, link structure, site architecture, hub pages

| Step | operationId |
|------|-------------|
| graph | `internalLinking` |
| hub | `linkExtractor` (seed URL = input url) |
| seo | `seoAnalyze` (hub page only) |

**Synthesizer output focus:**

- Orphan page list (top 10)
- Broken internal links (all)
- Recommended new links (top 15 with anchor + reason)
- Suggested hub pages to strengthen

---

## Phase 4 — Job catalog (backlog)

| Priority | Job ID | Workflow | New tool needed? |
|----------|--------|----------|------------------|
| P1 | `improve-core-web-vitals` | Phase 1 | TTFB upgrade only |
| P1 | `full-seo-optimization` | Phase 2 | Content v2 upgrade |
| P2 | `internal-link-architecture` | Phase 3 | No |
| P2 | `technical-seo-audit` | seo + links + speed (lite) | No |
| P2 | `social-preview-audit` | social only | Minor OG upgrades |
| P3 | `content-quality-audit` | content + AI text bridge | Maybe `contentIntentAudit` |
| P3 | `keyword-opportunity-review` | rankCheckerKeywords + content | Synthesis only |
| P3 | `local-page-seo` | existing local bridge | Polish |
| Done | `document-convert-pipeline` | exists | No |

### Local / MCP-only jobs (no URL)

Keep and extend content bridge (`content-adapters.json`):

| Job | Input | Tools / adapters |
|-----|-------|------------------|
| `seo-audit-local` | html | local SEO + link extract |
| `content-improve-local` | text/html/code | headline, jargon, PII, snippet |
| `link-extract-local` | html | link extract |

---

## Eval matrix (`tests/eval/goals.jsonl`)

Minimum 40 goals before Phase 2 ships:

| Category | Example goal | Expected jobId |
|----------|--------------|----------------|
| CWV | "fix LCP on my homepage {url}" | `improve-core-web-vitals` |
| CWV | "why is CLS bad {url}" | `improve-core-web-vitals` |
| SEO | "optimize this page for SEO {url}" | `full-seo-optimization` |
| SEO | "full seo audit {url}" | `seo-audit` or `full-seo-optimization` |
| Links | "find orphan pages {url}" | `internal-link-architecture` |
| Local | "audit this HTML before deploy" | `seo-audit-local` |
| Doc | "convert docx to pdf" | `docx-to-pdf` |
| Negative | "write me a poem" | `suggest` |

**Automated checks per goal:**

- `status === "completed"` (or `suggest` for negatives)
- `jobReport.schemaVersion` present when workflow job
- `prioritizedActions.length >= 1`
- No raw HTML in response

---

## Sprint calendar (8 weeks)

| Week | Deliverable | Packages |
|------|-------------|----------|
| 1 | Workflow returns all steps; contract types | `toolyour-mcp` |
| 2 | Synthesizer framework + `full-seo-audit` merged report | `toolyour-mcp` |
| 3 | TTFB + metric tags in page speed API | `toolyour-apis` |
| 4 | CWV job + task + skill + eval tests | `toolyour-mcp`, `toolyour-apis` |
| 5 | Content optimization v2 findings | `toolyour-apis` |
| 6 | Full SEO optimization job + task alias | `toolyour-mcp`, `toolyour-apis` |
| 7 | Internal link job + linking API prioritization | both |
| 8 | Docs, fact packs, eval expansion, `/developers/mcp` copy | `toolyour-docs`, `toolbox`, `blog-automation-worker` |

**Parallel track:** Meta CTR review (weeks 1–4) — no dependency on MCP jobs.

---

## Platform coupling checklist (per job ship)

- [ ] `registry/tasks.json` + `workflows.json` updated
- [ ] `skills/*.md` aligned (no phantom workflow ids)
- [ ] API changes → `docs` `build:openapi` if routes/schemas change
- [ ] `hasApi` unchanged unless new routes
- [ ] `toolyour-docs/customer` `mcp-*.mdx` — job examples
- [ ] `blog-automation-worker/content/fact-packs/mcp.json` — job count / capabilities
- [ ] `toolbox/utils/brand.ts` — only if positioning changes (e.g. "early phase" → "job workflows")
- [ ] Redeploy `toolyour-mcp` after registry/synthesizer changes
- [ ] `npm run validate` in blog-automation-worker

---

## Quota & billing notes

| Action | Bills quota? |
|--------|----------------|
| `discover_tools`, `get_tool_schema`, `list_skills` | No |
| `solve_task` → `suggest` / `need_input` | No |
| Each workflow step (`invoke_tool` backend) | Yes (1 per step) |
| Local content bridge adapters | Per adapter rules in `content-adapters.json` |

**Product decision:** Market multi-step jobs as one outcome; consider future `jobQuotaWeight` if 6-step SEO job feels expensive on free tier.

---

## New tools backlog (only when upgrades insufficient)

| Tool | operationId | Supports | Trigger to build |
|------|-------------|----------|------------------|
| Field CWV (CrUX/PSI) | `coreWebVitalsFieldData` | CWV job | Users need real field data |
| Content intent audit | `contentIntentAudit` | SEO, content jobs | Content v2 still too shallow |
| Schema markup checker | `schemaMarkupChecker` | Technical SEO | Repeated seoAnalyze gap |
| Heading/accessibility audit | `headingStructureAudit` | Content job | If not merged into content v2 |
| Page asset optimizer hints | ~~`pageAssetOptimizer`~~ | CWV / full SEO jobs | **Done inside `pageSpeedAnalyzer.evidence.assetOptimizer`** (no separate tool) |

---

## Explicit non-goals (this roadmap)

- Renaming tool slugs or public URLs
- Bulk rewrite of tool page body copy (wait for meta CTR + job eval)
- Semantic embedding router for `solve_task` (keyword match OK for Phase 1–2)
- Server-side fetch of localhost/staging URLs (agents still pass `html`/`text`)

---

## Next action (implementation)

Phase 0 synthesizers are live. Prefer deepening existing jobs (asset lists, link prioritization, eval harness) over new catalog tools. Field CrUX remains blocked on a paid/vendor decision.

See also: [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../../docs/PLATFORM-COUPLING.md`](../../docs/PLATFORM-COUPLING.md).
