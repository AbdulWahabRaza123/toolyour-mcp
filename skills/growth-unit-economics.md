---
id: growth-unit-economics
title: Growth Unit Economics
category: marketing
description: ROAS, CPC, CTR, CPA, CAC calculators.
operationIds: roasCalculator, cpcCalculator, ctrCalculator, cpaCalculator, cacCalculator
workflowId: growth-unit-economics-job
---

# Growth Unit Economics

## Inputs (numeric)

Provide the fields each calculator needs; missing steps continue with `continueOnError`.

| Metric | Fields |
|--------|--------|
| ROAS | `revenue`, `spend` |
| CPC | `spend`, `clicks` |
| CTR | `clicks`, `impressions` |
| CPA | `spend`, `conversions` |
| CAC | `spend`, `customers` |

Example:

```json
{
  "revenue": 10000,
  "spend": 2500,
  "clicks": 400,
  "impressions": 12000,
  "conversions": 50,
  "customers": 40
}
```

## Loop

1. `run_playbook("growth-unit-economics", { ... })`
2. After plan changes: `fix-verify-growth-unit-economics` or `verify_task`

Pure arithmetic from your inputs — not live ads platform data.
