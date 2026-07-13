---
id: content-quality
title: Content Quality
category: content
description: Audit content structure, readability, and keyword signals for a URL.
operationIds: contentOptimization, rankCheckerKeywords
---

# Content Quality Skill

For **content depth, headings, readability, or thin content** on a live URL:

1. Prefer `solve_task` with *"content quality audit for {url}"* → `content-quality-audit-job`.
2. Read `jobReport.workstreams.contentQuality` and `keywordSignals`.
3. For **unpublished HTML** (no URL), use `solve_task` with `input.html` → `seo-audit-local` / `local-page-seo`.
4. Summarize prioritized fixes — do not paste full page HTML.
