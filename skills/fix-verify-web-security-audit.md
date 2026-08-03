---
id: fix-verify-web-security-audit
title: Fix-Verify Web Security Audit
category: security
description: Re-run full security audit (headers, TLS, cookies, CORS, SRI, security.txt) after fixes; pair with verify_task.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, cookieSecurityAnalyzer, corsPolicyChecker, subresourceIntegrityChecker, securityTxtChecker
workflowId: full-security-audit
---

# Fix-Verify Web Security Audit

## Preferred path

1. Baseline = prior `web-security-audit` `jobReport` / solve result
2. `verify_task("fix verify security audit for https://…", { url }, baseline)`
3. Or `run_playbook("fix-verify-web-security-audit", { url })` then compare with `verify_task`
4. Summarize score deltas, `remainingFixes`, and `gate` only

## Output

- Remaining high findings first
- Stop when `gate === "pass"` or host policy allows residual medium/low
