---
id: page-performance
title: Page Performance
category: seo
description: Diagnose Core Web Vitals proxy metrics and prioritized fixes for a URL.
operationIds: pageSpeedAnalyzer, seoAnalyze, socialMediaIntegration
---

# Page Performance Skill

For **Core Web Vitals / performance** requests:

1. Prefer `solve_task` with goal like *"improve core web vitals for {url}"* → workflow `core-web-vitals-job`.
2. Read `jobReport.scores` for **LCP**, **TTFB**, **INP** (TBT proxy), and **CLS**.
3. Use `jobReport.prioritizedActions` for ranked fixes; cite `limitations` when explaining proxy vs field data.
4. Fallback: `discover_tools("page speed")` → `get_tool_schema` → `invoke_tool` with URL.
5. Do not paste raw HTML — summarize findings for the user.
