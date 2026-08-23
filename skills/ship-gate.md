---
id: ship-gate
title: Ship Gate
category: developer
description: Pass/fail pre-deploy smoke gate — headers, TLS, mixed content, HTTP status, and page-speed proxy (not Lighthouse).
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, mixedContentChecker, httpStatusChecker, pageSpeedAnalyzer
workflowId: ship-gate-job
---

# Ship Gate Skill

Use when the user wants a **go/no-go deploy smoke gate** on a **live or preview URL**.

**What this measures:** security headers, TLS cert, mixed content, HTTP status, and an **HTML page-speed proxy**. It is **not** Lighthouse, CrUX field data, a11y, or a penetration test.

**Payload first:** if they asked to check a PR, local files, or code **without** a link, use `pr-code-gate` (workspace `input.text` / `input.code`). Do not demand a URL.

**URL only** when they explicitly want a live fetch (preview deploy, staging, headers on the site). **Never pass localhost** — use workspace HTML or a public/preview https:// URL (or a tunnel URL).

## Host contract (any MCP agent)

1. `plan_task("ship gate for https://…")` — free; stop if `loop.initiate` is false  
2. `run_playbook("ship-gate", { url })` or `solve_task("ship gate https://…")`  
3. Apply **only** `loop.nextActions[0]` using `patchType` / `acceptance` / `roleHint` (usually `config` for headers)  
4. `verify_task` with the prior result as `baseline` until `loop.gate` is pass — or stop on `loop.stop`  
5. Do **not** `invoke_tool` for the same job  

First-run responses include `loop.line` (gate · rank-1 · credits), `loop.remainingFixes`, `loop.receipt`, and rank-1 `loop.nextActions`.

## Gate policy (`gatePolicy: ship`)

- Fail on high findings or any **poor** score
- Fail on **needs_improvement** or **unknown** for TLS, security headers, HTTP status, or mixed content
- Performance proxy **needs_improvement** alone does **not** fail the ship gate
- `status: partial` / incomplete reports never count as pass

## Output

- High-severity blockers first
- Prioritized actions from `jobReport`
- Do not claim production-ready without human QA

Golden path: `docs/TIER1-GOLDEN-PATH.md`
