---
id: ship-gate
title: Ship Gate
category: developer
description: Pass/fail pre-deploy gate — headers, TLS, mixed content, HTTP status, and page speed.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, mixedContentChecker, httpStatusChecker, pageSpeedAnalyzer
workflowId: ship-gate-job
---

# Ship Gate Skill

Use when the user wants a **go/no-go deploy gate**.

## Preferred path

1. `plan_task("ship gate for https://…")` — free estimate
2. `run_playbook("ship-gate", { url })` or `solve_task("ship gate https://…")`
3. After fixes: `verify_task` with the previous result as `baseline`

## Output

- High-severity blockers first
- Prioritized actions from `jobReport`
- Do not claim production-ready without human QA
