---
id: seo-site-audit
title: SEO Site Audit
category: seo
description: Crawl a URL and run on-page SEO checks using API-backed ToolYour tools.
operationIds: seoAnalyze, pageSpeedAnalyzer
---

# SEO Site Audit Skill

Use this playbook when the user wants a **site or page SEO audit**.

## Steps

1. Call `discover_tools` with query `seo crawl` if you need exact operationIds.
2. Call `get_tool_schema` for each tool before invoking.
3. **Local / unpublished pages:** use `solve_task` with workspace content — no deployed URL required:
   - `input.html` — rendered page or HTML file (free on-page SEO audit + link extract)
   - `input.text` — copy for headline/jargon/snippet/PII tools
   - `input.code` — TSX/JSX/HTML source; MCP extracts text automatically
   - Set `input.enhance: false` to skip billed API text tools (local analysis only)
4. **Deployed or staging sites:** `solve_task` with a public URL, or `invoke_tool` after schema lookup.
5. Summarize **top issues**, **metrics**, and **fix priorities** for the user.
6. Do not paste raw HTML — use summarized MCP responses only.

## Output format

- Executive summary (3–5 bullets)
- Critical issues
- Recommended next tools (from discover_tools)
