---
id: social-preview
title: Social Preview
category: seo
description: Audit Open Graph and Twitter Card tags for social link previews.
operationIds: socialMediaIntegration
workflowId: social-preview-audit-job
---

# Social Preview Skill

For **Open Graph / Twitter Card / link preview** requests:

1. Prefer `solve_task` with *"audit social preview for {url}"* → workflow `social-preview-audit-job`.
2. Read `jobReport.scores.openGraph` and `jobReport.scores.twitterCard` for coverage status.
3. Summarize missing tags and image/URL issues from `jobReport.findings` — do not paste raw HTML.
4. Fallback: `invoke_tool` with `socialMediaIntegration` after `get_tool_schema`.
