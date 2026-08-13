---
id: web-security-audit
title: Web Security Audit
category: security
description: Audit a URL for security headers, TLS, cookies, CORS, SRI, and security.txt using ToolYour API tools.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, cookieSecurityAnalyzer, corsPolicyChecker, subresourceIntegrityChecker, securityTxtChecker, cspPolicyEvaluator, spfDkimDmarcChecker
workflowId: full-security-audit
---

# Web Security Audit Skill

Use this playbook when the user wants a **web / HTTPS security posture check** for a **public URL** or domain.

**Payload first:** pasted env, JWT, CSP string, or config → `secrets-and-auth-hygiene` / `cspPolicyEvaluator` / `pr-code-gate`. Do not demand a live URL for those. TLS, mixed content, and live headers stay fetch-only.

## Preferred path

1. **`run_playbook("web-security-audit", { url })`** or `solve_task("security audit {url}")` → workflow **`full-security-audit`**
   - Steps: headers → TLS → cookies → CORS → SRI → security.txt
2. Follow-ups (not in the URL job):
   - Paste CSP string → `cspPolicyEvaluator`
   - SPF/DKIM/DMARC → `run_playbook("dns-email-security")` / `email-auth-security-job`
   - Frontend assets focus → `run_playbook("frontend-supply-chain")`
3. Mixed HTTP assets → SEO **mixed content** tool (or frontend-supply-chain playbook).
4. Summarize **severity**, **top findings**, and **fix priorities** from `jobReport`.
5. Do not claim the site is “fully secure” from headers/TLS alone.

## Fallback invoke

`discover_tools` → `get_tool_schema` → `invoke_tool` for individual Phase 1–3 security tools.

## Output format

- Executive summary (3–5 bullets)
- Critical / fail items first
- Warn items next
- Recommended follow-ups (`dns-email-security`, `frontend-supply-chain`, `secrets-and-auth-hygiene`, `ship-gate`)
