---
id: page-performance
title: Page Performance
category: seo
description: Diagnose Core Web Vitals proxy metrics and prioritized fixes for a URL (alias skillIds - core-web-vitals, improve-core-web-vitals).
operationIds: pageSpeedAnalyzer, seoAnalyze, socialMediaIntegration
workflowId: core-web-vitals-job
---

# Page Performance Skill

For **Core Web Vitals / performance** requests:

1. Prefer `solve_task` with goal like *"improve core web vitals for {url}"* → workflow `core-web-vitals-job`.
2. Read `jobReport.scores` for **LCP**, **TTFB**, **INP** (TBT proxy), and **CLS**.
3. Use `jobReport.prioritizedActions` for ranked fixes — prefer actions with `workstream: "assets"` when present (compress images, defer scripts, CLS dimensions).
4. Read `jobReport.workstreams.assets.assetOptimizer` for concrete URLs (`compressImages`, `deferScripts`, `fixDimensions`, `preloadHints`). Cite `limitations` when explaining proxy vs field data.
5. To **convert those images to WebP**, use `run_playbook("frontend-webp", { url })` — do not invent a new converter.
6. Fallback: `discover_tools("page speed")` → `get_tool_schema` → `invoke_tool` with URL.
7. Do not paste raw HTML — summarize findings for the user.
