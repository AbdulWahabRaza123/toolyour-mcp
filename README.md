# ToolYour MCP

Agent-native MCP gateway exposing **only API-backed tools** (`hasApi: true`).

## Quick start

```bash
cp .env.example .env
npm install
npm run build:registry   # from docs/
npm run dev
```

Endpoint: `http://localhost:3090/mcp` (SSE)

Health: `GET /health/mcp`, `GET /health/mcp/ready`

## Auth

Pass API key via MCP client config header:

```
X-Api-Key: ty_...
```

## Registry

Regenerate after OpenAPI changes:

```bash
npm run build:registry
# With Mongo hasApi filter:
TOOLS_MONGO_URI=mongodb://... npm run build:registry --prefix ../docs
```

## Tests

```bash
npm run validate:jobs    # build + lint + unit + offline job parity
npm run smoke:jobs:live  # requires MCP_API_KEY + gateway at :8888
npm test                 # alias: test:mcp
```

See [`docs/DEPLOY-CHECKLIST.md`](docs/DEPLOY-CHECKLIST.md) for deploy order and live smoke steps.

## Job workflows (`solve_task`)

Shipped synthesizer workflows (return `toolyour.jobReport@1` when matched):

| Workflow ID | Purpose |
|-------------|---------|
| `full-seo-audit` | SEO + page speed |
| `core-web-vitals-job` | CWV diagnosis |
| `full-seo-optimization-job` | Full on-page optimization (6 tools) |
| `internal-link-architecture-job` | Orphans, broken links, hub pages |
| `technical-seo-audit-job` | Lite technical audit |
| `social-preview-audit-job` | Open Graph / Twitter Card |
| `content-quality-audit-job` | Content + keyword signals |
| `keyword-opportunity-review-job` | Keyword gaps + opportunities |
| `document-convert-pipeline` | DOCX → PDF |

Registry: `registry/workflows.json`, `registry/tasks.json`. Roadmap: [`docs/MCP-JOBS-ROADMAP.md`](docs/MCP-JOBS-ROADMAP.md).
