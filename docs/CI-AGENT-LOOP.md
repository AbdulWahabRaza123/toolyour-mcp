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

## Control-plane merge gate (coding jobs)

This is **not** ship-gate. Frozen host checks + `decide()`: fail CI unless `job.state === verified`. Agent “I’m done” is not a pass.

```bash
npx toolyour-check-run --job <jobId> --cwd . --require-verified
```

Writes `DECISION.json` and `EVIDENCE.json`. Copy [`examples/github-actions/control-plane-merge-gate.yml`](../examples/github-actions/control-plane-merge-gate.yml) into an app repo. Leave `pull_request` commented until you have a job id; do not add it as a required check on this MCP package.

Composite action (after the SDK is on the default branch): `toolyour-sdk/.github/actions/control-plane-merge-gate`.

HIGH/CRITICAL **declared** actions also block `verified` (rule R9) until `job_approve` for that `actionId`. This is contractual — undeclared terminal commands are out of contract. Dashboard ApprovalBatch is not shipped.

Optional frozen check kind `playwright`: the host CLI runs `npx playwright test …` from `job_status` (120s default). MCP never launches Chromium. Template id `host-playwright` is not in the task-1…task-5 eval.

Phase 5 (ToolYour-owned sandbox / `execution.run`): **NO-GO**. Host Playwright MCP and GitHub MCP stay complementary. See [`experiments/SANDBOX-NOGO.md`](../experiments/SANDBOX-NOGO.md).

## GitHub Actions example (ship-gate URL jobs)

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
