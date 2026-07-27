---
id: web-security-audit
title: Web Security Audit
category: security
description: Audit a URL for security headers, TLS, cookies, and email auth using ToolYour API tools.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, cookieSecurityAnalyzer, spfDkimDmarcChecker, cspPolicyEvaluator, corsPolicyChecker, subresourceIntegrityChecker, securityTxtChecker
---

# Web Security Audit Skill

Use this playbook when the user wants a **web / HTTPS security posture check** for a public URL or domain.

## Steps

1. Call `discover_tools` with query `security headers tls cookie csp` if you need exact operationIds.
2. Call `get_tool_schema` for each tool before invoking.
3. **Preferred multi-tool path:** `solve_task` with a public `https://` URL and phrasing like:
   - *"security audit {url}"* / *"harden this site"* → workflow `full-security-audit`
   - *"check security headers for {url}"* → `securityHeadersAnalyzer` or `security-headers-job`
   - *"evaluate this CSP"* → `cspPolicyEvaluator` (paste policy text)
   - *"spf dkim dmarc for {domain}"* → `spfDkimDmarcChecker` or `email-auth-security-job`
4. **Fallback:** `invoke_tool` for Phase 1–3 checks:
   - `securityHeadersAnalyzer` — CSP, HSTS, XFO, and related headers
   - `cspPolicyEvaluator` — paste CSP string for unsafe-inline/eval gaps
   - `sslTlsCertificateChecker` — certificate expiry / optional PEM
   - `cookieSecurityAnalyzer` — Secure / HttpOnly / SameSite
   - `corsPolicyChecker` / `subresourceIntegrityChecker` / `securityTxtChecker`
   - `spfDkimDmarcChecker` — email auth DNS
5. Mixed HTTP assets → SEO **mixed content** tool (do not invent a duplicate security slug).
6. Summarize **severity**, **top findings**, and **fix priorities**. Prefer `jobReport` when a workflow ran.
7. Do not claim the site is “fully secure” from headers/TLS alone.

## Output format

- Executive summary (3–5 bullets)
- Critical / fail items first
- Warn items next
- Recommended follow-ups (`secrets-and-auth-hygiene`, `developer-ship-checklist`)
