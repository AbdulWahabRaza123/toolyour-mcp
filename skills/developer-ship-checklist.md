---
id: developer-ship-checklist
title: Developer Ship Checklist
category: developer
description: Pre-deploy gate combining security headers/TLS with mixed content, HTTP status, speed, and related SEO ship tools.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, cookieSecurityAnalyzer, mixedContentChecker, httpStatusChecker, redirectChainAnalyzer, robotsTxtChecker, pageSpeedAnalyzer, seoChangeDiff, corsPolicyChecker, httpSecurityRedirectChecker, secretLeakScanner, dnsLookup
---

# Developer Ship Checklist Skill

Use this playbook when the user asks **before deploy**, **ship checklist**, **prod readiness**, or **harden and ship**.

## Preferred path

1. For a public URL, call `solve_task` / `run_workflow` with workflow **`developer-ship-checklist-job`**.
2. That job runs: `securityHeadersAnalyzer` → `sslTlsCertificateChecker` → `mixedContentChecker` → `httpStatusChecker` → `pageSpeedAnalyzer` and returns a `jobReport`.

## Extra checks (invoke when relevant)

| Intent | Tool |
|--------|------|
| Cookie flags on login/app URLs | `cookieSecurityAnalyzer` |
| Redirect / open-redirect hygiene | `httpSecurityRedirectChecker` or `redirectChainAnalyzer` |
| CORS misconfig | `corsPolicyChecker` |
| DNS A/MX/TXT | `dnsLookup` |
| robots.txt | `robotsTxtChecker` |
| Staging vs prod template SEO | `seoChangeDiff` |
| Pasted env secrets | `secretLeakScanner` (or workflow `secrets-hygiene-job`) |

## Steps

1. Confirm a public `https://` URL (or staging URL the gateway can reach).
2. Run `developer-ship-checklist-job` first.
3. Add targeted tools from the table based on user concerns.
4. Present **high-severity findings first**, then prioritized actions from `jobReport`.
5. Do not claim “production ready” from this smoke gate alone — call out remaining human QA (auth flows, a11y, load tests).

## Output format

- Ship readiness summary (pass / blockers)
- Blockers (high severity)
- Warnings
- Ordered fix list
