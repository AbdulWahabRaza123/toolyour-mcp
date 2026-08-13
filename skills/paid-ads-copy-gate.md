---
id: paid-ads-copy-gate
title: Paid Ads Copy Gate
category: marketing
description: Ads copy limits and Google RSA preview.
operationIds: adsCopyCounter, googleAdsRsaPreview
workflowId: paid-ads-copy-gate-job
---

# Paid Ads Copy Gate

Pass **copy fields** from the brief (`headline`, `headlines[]`, `descriptions[]`). Do not ask for a landing URL unless the user asked to audit a live page.

## Inputs

| Field | Required | Notes |
|-------|----------|--------|
| `platform` | for counter | `google-rsa`, `meta`, `linkedin`, `tiktok`, `youtube` |
| `headline` / `primaryText` / `description` | for counter | Flat copy fields |
| `headlines` | for RSA | string array, each ≤30 chars |
| `descriptions` | for RSA | string array, each ≤90 chars |

Example:

```json
{
  "platform": "google-rsa",
  "headline": "Shop new arrivals",
  "primaryText": "Free shipping over $50",
  "description": "Easy returns on all orders",
  "headlines": ["Shop new arrivals", "Free shipping today", "Limited-time sale"],
  "descriptions": ["Browse new arrivals with free returns.", "Top brands with easy checkout."]
}
```

## Loop

1. `plan_task`
2. `run_playbook("paid-ads-copy-gate", { ... })`
3. After fixes: `run_playbook("fix-verify-paid-ads-copy-gate", { ... })` or `verify_task`

Limits are approximate platform defaults — confirm in Ads Manager before launch.
