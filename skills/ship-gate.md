---
id: ship-gate
title: Ship Gate
category: developer
description: Pass/fail pre-deploy gate — headers, TLS, mixed content, HTTP status, and page speed.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, mixedContentChecker, httpStatusChecker, pageSpeedAnalyzer
workflowId: ship-gate-job
---

# Ship Gate Skill

Use when the user wants a **go/no-go deploy gate** on a **live or preview URL**.

**Payload first:** if they asked to check a PR, local files, or code **without** a link, use `pr-code-gate` (workspace `input.text` / `input.code`). Do not demand a URL.

**URL only** when they explicitly want a live fetch (preview deploy, staging, Lighthouse, headers on the site).

## Preferred path

1. `plan_task("ship gate for https://…")` — free estimate
2. `run_playbook("ship-gate", { url })` or `solve_task("ship gate https://…")`
3. After fixes: `verify_task` with the previous result as `baseline`, or `run_playbook("fix-verify-ship-gate", { url })`

## Output

- High-severity blockers first
- Prioritized actions from `jobReport`
- Do not claim production-ready without human QA
