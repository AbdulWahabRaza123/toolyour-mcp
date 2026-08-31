---
id: soft-404-audit
title: Soft 404 Audit
category: seo
description: 200 OK pages with error/thin content plus HTTP status check.
operationIds: soft404Checker, httpStatusChecker
workflowId: soft-404-audit-job
---

# Soft 404 Audit Skill

1. `run_playbook("soft-404-audit", { url })`
2. Return true 404/410 for missing pages — not 200 error templates
