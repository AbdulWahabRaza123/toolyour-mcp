---
id: pr-code-gate
title: PR Code Gate
category: developer
description: Payload-first PR/ship check on workspace files — secrets scan plus format/validate via invoke_tool. Ask for a live URL only if the user wants link analysis.
operationIds: secretLeakScanner, jwtDecoder, jsonValidator, jsonFormatter, yamlToJson, jsFormatter, htmlFormatter, cssFormatter, sqlValidator, xmlFormatter
workflowId: secrets-hygiene-job
---

# PR Code Gate

MCP cannot read disk. The **host agent** reads the repo (or git diff) and passes `input.text` / `input.code` / `input.html` / `input.json`.

**Default:** files first. **URL only** if the user explicitly asked to analyze a live/preview/staging link (then use `ship-gate` / `pr-preview-gate`).

## Preferred path

1. `plan_task("ship this PR before merge")` — free
2. Read changed files; call `run_playbook("pr-code-gate", { text })` or `solve_task` with `input.text` / `input.code` / `input.html`
3. Map extra files with `invoke_tool` using the table below
4. If `.env` / config / tokens appear, keep them in the same `text` payload (always-on secrets)
5. After fixes: `verify_task` with the previous `jobReport` as baseline

Do **not** invent a URL, scrape GitHub, or retarget `ship-gate-job` fetch steps (PageSpeed, TLS, mixed content).

## File / payload → invoke_tool

| Surface | Input | Tool / job |
|---------|--------|------------|
| `.json` | `input.json` or `input.text` | `jsonValidator`, `jsonFormatter`; types → `jsonToZod` / `jsonToTypescript` (`dev-json-pipeline`) |
| `.yml` / `.yaml` | `input.text` | `yamlToJson` (then JSON tools) |
| `.js` / `.ts` / `.jsx` | `input.code` | `jsFormatter`; minify → `jsMinifier` |
| `.css` | `input.code` | `cssFormatter`; minify → `cssMinifier` |
| `.html` | `input.html` | `htmlFormatter`; on-page SEO → `seo-audit-local` / `content-ship` (free unless `enhance:true`) |
| `.sql` | `input.text` | `sqlValidator`, `sqlFormatter` (heuristics only — no database) |
| `.xml` | `input.text` | `xmlFormatter` |
| `.env` / config / logs | `input.text` | **Always** `secretLeakScanner`; JWT-shaped → `jwtDecoder` (`secrets-hygiene-job`) |
| JWT paste | `input.token` or `input.text` | `jwtDecoder` / `auth-token-hygiene` |
| CSP string | `input.text` | `cspPolicyEvaluator` — not live TLS |
| Marketing copy / UTM fields | `input.text` + UTM fields | `utmBuilder`, `adsCopyCounter`, `emailSubjectLineTester` |
| HTML email / subject | `input.subject` / `input.text` | `emailSubjectLineTester`, `emailSpamWordChecker` |
| Convert / docs (file bytes) | multipart `file` | existing convert workflows — not a website URL |
| Fetch-only (need `https://`) | `input.url` | `pageSpeedAnalyzer`, `sslTlsCertificateChecker`, `mixedContentChecker`, live `httpStatusChecker`, `robotsTxtChecker` fetch, `sitemapXmlValidator` fetch, live `securityHeadersAnalyzer` — **only if the user asked to fetch a live page** |

Landing *live* CTA finder stays URL (`landing-conversion-check`). Unpublished HTML → `content-ship` / `seo-audit-local`.

## Live-link branch

If the user said `this url`, `live site`, `preview deploy`, `staging url`, `Lighthouse`, or `headers on the site`:

1. `run_playbook("ship-gate", { url })` or `pr-preview-gate` for ephemeral preview URLs
2. Do not run this payload skill as a substitute for PageSpeed/TLS

## Output

- Secrets / JWT findings first
- Formatter/validator notes from any `invoke_tool` follow-ups
- Honest: this is not an LLM code review and not a live crawl
