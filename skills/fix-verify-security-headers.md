---
id: fix-verify-security-headers
title: Fix-Verify Security Headers
category: security
description: Re-run security headers after CSP/HSTS/etc. fixes; pair with verify_task.
operationIds: securityHeadersAnalyzer
workflowId: security-headers-job
---

# Fix-Verify Security Headers

## Preferred path

1. Baseline = prior `jobReport` from `security-headers` / `web-security-audit`
2. `verify_task("fix verify security headers for https://…", { url }, baseline)`
3. Summarize score delta + resolved vs new findings only
