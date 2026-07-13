---
id: content-refresh
title: Content Refresh
category: content
description: Audit outdated content and suggest refresh using AI + SEO tools.
operationIds: aiTextAi, contentOptimization
---

# Content Refresh Skill

When refreshing **blog or landing page content**:

1. For a live URL, prefer `solve_task` with *"optimize this page for SEO {url}"* → `full-seo-optimization-job`.
2. Crawl or fetch page text via API-backed tools.
3. Use AI text tools (`discover_tools("ai text")`) for rewrite suggestions.
4. Compare against SEO metadata tools if available.
5. Deliver: gaps, updated outline, and suggested meta title/description from `jobReport.workstreams.contentQuality`.
