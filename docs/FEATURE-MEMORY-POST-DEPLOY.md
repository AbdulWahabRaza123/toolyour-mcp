# Feature Memory — post-deploy test checklist

Run after SaaS + MCP + toolbox + customer docs are deployed.

## 1. SaaS indexes

```bash
cd toolyour-saas && npm run migrate:ensure-indexes
```

Expect `FeatureMemory` and `FeatureMemoryNotification` indexes in sync.

## 2. MCP live probe (uses API key from `.cursor/mcp.json`)

```bash
cd toolyour-mcp && npm run probe:live
```

New checks (4):

| Probe | Pass criteria |
|-------|----------------|
| `feature_memory_record_keeping` | `plan_task` → `featureMemory.recordKeeping.policy === toolyour_auto_record` |
| `list_feature_memory_ok` | `status=ok`, `features` array |
| `list_community_patterns_ok` | `status=ok`, `patterns` array |
| `feature_memory_tools_registered` | `capture_feature`, `compare_feature_memory`, `publish_feature_pattern`, `list_community_patterns` in `tools/list` |

Full suite should be **17/17** pass on `api.toolyour.com`.

## 3. Dashboard (signed in)

- https://www.toolyour.com/dashboard/feature-memory loads
- API proxy `GET /api/saas/feature-memory` returns `{ features, notifications }`

## 4. Customer docs

- https://www.toolyour.com/developers/docs/feature-memory (after Pages deploy)

## 5. End-to-end memory flow (manual or agent)

1. `plan_task("build OCR…")` → `recordKeeping` present
2. Run a closable job → `verify_task` until `loop.gate=pass`
3. Response includes `featureMemoryRecord.featureId`
4. `plan_task` in a “new project” goal → `priorInstances` or reminder when similar

## 6. Blog allowlist (before promo post)

`npm run validate` in `blog-automation-worker` — URLs already allowlisted:

- `/dashboard/feature-memory`
- `/developers/docs/feature-memory`

## Not required for v1

| Surface | Why skip |
|---------|----------|
| `@toolyour/sdk` npm | Feature Memory is MCP meta-tools, not REST OpenAPI |
| OpenAPI registry rebuild | No new REST routes |
| `build:mcp-registry` | Catalog tools unchanged |
| Homepage hero rewrite | Harness story: lead ship-gate/SEO; Feature Memory is secondary MCP |
| Public marketing landing | Promote after probe green — optional `/developers/feature-memory` later |
