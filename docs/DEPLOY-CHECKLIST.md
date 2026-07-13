# MCP job workflows — deploy checklist

Use after shipping new `solve_task` jobs. Keeps MCP, gateway, docs, and marketing in sync.

## 1. Pre-deploy (local)

```bash
cd toolyour-mcp
npm install
npm run build
npm run validate:jobs
```

`validate:jobs` runs: build → lint:skills → unit tests → offline job parity → eval goal routing.

## 2. Live smoke (requires full local stack)

Start gateway + backends (see `infra/README.md`):

- API gateway: `http://127.0.0.1:8888`
- toolyour-mcp: `:3090` (proxied at `/mcp`)
- toolyour-saas validate-key
- toolyour-apis (+ py-apis if needed)

```powershell
$env:MCP_API_KEY = "ty_..."
$env:MCP_URL = "http://127.0.0.1:8888/mcp"
npm run smoke:jobs:live
# or full meta-tool pass:
node scripts/test-mcp-local.mjs
```

**Pass criteria:** `solve_task` returns `status: completed` and `execution.jobReport.schemaVersion === "toolyour.jobReport@1"` for workflow goals.

## 3. Deploy order

| Step | Package | Action |
|------|---------|--------|
| 1 | `toolyour-apis` | Deploy if SEO/social API report fields changed |
| 2 | `toolbox` | Deploy if types/UI or `/developers/mcp` changed |
| 3 | `toolyour-mcp` | `npm run build` → deploy (Railway) |
| 4 | `infra` | Confirm `UPSTREAM_MCP_HOST` + gateway `/mcp` route |
| 5 | `toolyour-docs/customer` | Deploy Pages — `mcp-skills.mdx`, job workflow table |
| 6 | `blog-automation-worker` | `npm run validate` after `fact-packs/mcp.json` changes |

## 4. Post-deploy verification

```bash
curl -s https://api.toolyour.com/health/mcp
# MCP client: solve_task("technical seo audit https://example.com")
```

Confirm:

- [ ] `/developers/mcp` lists job workflows (from `brand.mcpJobWorkflows`)
- [ ] Customer docs `/developers/docs/mcp-skills` shows new workflows
- [ ] No blog/docs promise workflows that 404

## 5. Platform coupling reminder

- New **routes** → OpenAPI + `npm run build:registry` in `docs`
- New **public URLs** → sitemap, allowlists, live check before linking
- **solve_task** stays **early phase** in copy until routing maturity is intentionally upgraded in `brand.ts` + `llms.txt`
