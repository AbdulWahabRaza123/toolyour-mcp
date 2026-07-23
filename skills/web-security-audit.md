---
id: web-security-audit
title: Web Security Audit
category: security
description: Audit a URL for security headers, TLS, cookies, and email auth using ToolYour API tools.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, cookieSecurityAnalyzer, spfDkimDmarcChecker
---

# Web Security Audit Skill

Use this playbook when the user wants a **web / HTTPS security posture check** for a public URL or domain.

## Steps

1. Call `discover_tools` with query `security headers tls cookie` if you need exact operationIds.
2. Call `get_tool_schema` for each tool before invoking.
3. **Preferred multi-tool path:** `solve_task` with a public `https://` URL and phrasing like:
   - *"security audit {url}"* / *"harden this site"* → prefer workflow `full-security-audit` when available
   - *"check security headers for {url}"* → `securityHeadersAnalyzer` or workflow `security-headers-job` when available
   - *"spf dkim dmarc for {domain}"* → `spfDkimDmarcChecker` (or workflow `email-auth-security-job` when available)
4. **Fallback:** `invoke_tool` for each Phase 1 check:
   - `securityHeadersAnalyzer` — CSP, HSTS, XFO, and related headers
   - `sslTlsCertificateChecker` — certificate expiry, SAN, issuer (not a full SSL Labs grade)
   - `cookieSecurityAnalyzer` — Secure / HttpOnly / SameSite on Set-Cookie
   - `spfDkimDmarcChecker` — email auth DNS (domain or URL)
5. If the user mentions mixed HTTP assets on HTTPS, discover the SEO **mixed content** tool (do not invent a duplicate security slug).
6. Summarize **severity**, **top findings**, and **fix priorities**. Prefer `jobReport` when a workflow ran; otherwise merge step outputs.
7. Do not claim the site is “fully secure” from headers/TLS alone.

## Output format

- Executive summary (3–5 bullets)
- Critical / fail items first
- Warn items next
- Recommended follow-ups (JWT/password tools → load skill `secrets-and-auth-hygiene` when relevant)
