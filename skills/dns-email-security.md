---
id: dns-email-security
title: DNS and Email Security
category: security
description: Check SPF/DKIM/DMARC, general DNS records, and security.txt for a domain.
operationIds: spfDkimDmarcChecker, dnsLookup, securityTxtChecker
workflowId: email-auth-security-job
---

# DNS and Email Security Skill

Use when the user asks about **email authentication**, **DNS records**, or **security.txt / vulnerability disclosure** for a domain.

## Preferred path

1. `run_playbook("dns-email-security")` / `solve_task` → **`email-auth-security-job`** (SPF/DKIM/DMARC → DNS lookup → security.txt).
2. Broader URL harden without email focus → `web-security-audit` (includes security.txt among other URL checks).
3. Otherwise invoke tools in order:
   - `spfDkimDmarcChecker` — email auth DNS
   - `dnsLookup` — A/AAAA/MX/TXT/NS/CNAME
   - `securityTxtChecker` — RFC 9116 discovery

## Steps

1. Normalize input to a domain or `https://` URL.
2. Run the workflow or tools above.
3. Summarize missing SPF/DKIM/DMARC, MX/TXT gaps, and security.txt Contact/Expires.
4. Do not claim DNSSEC validation (not covered).

## Output format

- Email auth status (SPF / DKIM / DMARC)
- Notable DNS records
- security.txt presence + Contact
- Prioritized fixes
