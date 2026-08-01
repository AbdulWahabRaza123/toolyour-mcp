---
id: fix-verify-ship-gate
title: Fix-Verify Ship Gate
category: developer
description: Re-run the ship gate after deploy fixes and compare with verify_task.
operationIds: securityHeadersAnalyzer, sslTlsCertificateChecker, mixedContentChecker, httpStatusChecker, pageSpeedAnalyzer
workflowId: ship-gate-job
---

# Fix-Verify Ship Gate

Use after the agent (or user) applied ship-gate blockers.

## Preferred path

1. Keep the previous `solve_task` / `run_playbook("ship-gate")` result as `baseline`
2. `verify_task("fix verify ship gate for https://…", { url }, baseline)`
   - or `run_playbook("fix-verify-ship-gate", { url })` then diff manually
3. Report only **deltas** (resolved findings, score moves, remaining blockers)

## Rules

- Do not re-dump full step JSON when a delta is enough
- Fail closed: unresolved high-severity items stay blockers
