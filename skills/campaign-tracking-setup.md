---
id: campaign-tracking-setup
title: Campaign Tracking Setup
category: marketing
description: UTM builder, ads macros, and parser hygiene.
operationIds: utmBuilder, adsUtmBuilder, utmParser
workflowId: campaign-tracking-setup-job
---

# Campaign Tracking Setup

## Inputs (required / useful)

| Field | Required | Notes |
|-------|----------|--------|
| `baseUrl` or `url` | yes | Landing URL without UTMs |
| `utm_source` | yes | e.g. `google` |
| `utm_medium` | yes | e.g. `cpc` |
| `utm_campaign` | yes | e.g. `spring-sale` |
| `utm_term` / `utm_content` / `utm_id` | optional | Extra UTM params |
| `platform` | optional | Ads macros: `google`, `meta`, `tiktok`, `linkedin`, `microsoft` |

Example:

```json
{
  "baseUrl": "https://example.com/landing",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "spring-sale",
  "platform": "google"
}
```

## Loop

1. `plan_task` (free estimate)
2. `run_playbook("campaign-tracking-setup", { ... })` or `solve_task`
3. After fixes: `verify_task` with baseline, or `run_playbook("fix-verify-campaign-tracking-setup", { ... })`

Deterministic ToolYour marketing tools — not an ads manager and not live GA4 attribution.
