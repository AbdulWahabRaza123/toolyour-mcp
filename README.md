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
npm test
```
