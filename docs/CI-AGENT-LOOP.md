# CI agent loop (ship-gate / verify)

Agents and CI should treat ToolYour as a **poll-first** harness. Webhooks are optional best-effort.

## Recommended pattern

```text
1. solve_task / run_playbook(..., async: true)  → { runId }
2. poll get_run(runId) until status is completed|partial|error
3. read resultStatus (and result.status) — completed ≠ success
4. keep result (or jobReport) as baseline
5. after fixes: verify_task(..., baseline, async: true) → poll again
6. stop when delta.gate === "pass" (or policy allows remainingFixes)
```

## get_run fields that matter

| Field | Meaning |
|-------|---------|
| `status` | Run lifecycle (`running`, `completed`, `partial`, `error`) |
| `resultStatus` | Semantic outcome (`suggest`, `verified`, `need_input`, …) |
| `result` | Full tool payload (peel `jobReport` / `execution.jobReport`) |

## Optional webhook (`mcp.job.finished`)

- Configure in the ToolYour dashboard (per account).  
- HMAC header: `X-ToolYour-Signature`.  
- **Never** require webhook success for job completion.  
- CI should still poll `get_run` as source of truth.  
- Multi-replica: set `REDIS_URL` on MCP so `get_run` works across instances.

## Minimal GitHub Actions sketch

```yaml
# Pseudocode — wire secrets TOOLYOUR_API_KEY + PREVIEW_URL
- name: Ship-gate via MCP
  run: |
    node scripts/ci-ship-gate.mjs
```

`scripts/ci-ship-gate.mjs` (team-owned): call MCP HTTP/SSE or REST-adjacent invoke, poll until done, exit `1` if `delta.gate === "fail"` or high severity `remainingFixes` remain.

## Related

- [`HARNESS-MIGRATION.md`](./HARNESS-MIGRATION.md)  
- Customer docs: `/developers/docs/mcp-quickstart`
