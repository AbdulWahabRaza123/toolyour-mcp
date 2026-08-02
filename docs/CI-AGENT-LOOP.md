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

## Ship-gate script (this repo)

```bash
TOOLYOUR_API_KEY=ty_... SHIP_URL=https://preview.example.com \
  node scripts/ci-ship-gate.mjs
```

- Exit `0` when `delta.gate === "pass"` (or local jobReport has no high findings / poor scores).  
- Exit `1` on `fail` / errors.  
- Exit `0` with `SKIP` if no API key (optional local).  
- `REQUIRE_PASS=false` prints the report without failing the job.

## GitHub Actions example

Copy [`examples/github-actions/ship-gate.yml`](../examples/github-actions/ship-gate.yml) into your app repo. Wire `secrets.TOOLYOUR_API_KEY` and a preview `SHIP_URL`.

Or use the SDK in your own Node step:

```typescript
import { verifyUntilPass } from "@toolyour/sdk/mcp";
const r = await verifyUntilPass({
  apiKey: process.env.TOOLYOUR_API_KEY!,
  goal: `ship gate for ${process.env.SHIP_URL}`,
  input: { url: process.env.SHIP_URL! },
});
if (r.gate !== "pass") process.exit(1);
```

## Related

- [`HARNESS-MIGRATION.md`](./HARNESS-MIGRATION.md)  
- Customer docs: `/developers/docs/mcp-quickstart`  
- npm: `@toolyour/sdk` (`verifyUntilPass`)
