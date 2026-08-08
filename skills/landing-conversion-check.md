---
id: landing-conversion-check
title: Landing Conversion Check
category: marketing
description: CTA finder, forms, and marketing tags for a URL.
operationIds: landingPageCtaFinder, formFieldInventory, marketingTagExtractor
workflowId: landing-conversion-check-job
---

# Landing Conversion Check

## Inputs

| Field | Required | Notes |
|-------|----------|--------|
| `url` | yes | Public landing page URL |

Example:

```json
{
  "url": "https://example.com/landing"
}
```

## Loop

1. `run_playbook("landing-conversion-check", { url })`
2. Pair with SEO `page-performance` / `seo-site-audit` for full ship checks.
3. After fixes: `fix-verify-landing-conversion-check`

HTML heuristics only — not a full CRO audit or heatmaps.
