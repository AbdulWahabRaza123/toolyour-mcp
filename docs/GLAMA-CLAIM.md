# Glama connector claim + health

Listing: https://glama.ai/mcp/connectors/com.toolyour.api/tool-your-mcp-server

Namespace `com.toolyour.api` → verify **api.toolyour.com**.

## Why Unhealthy

Glama’s probe needs Streamable HTTP **with** auth. Unauthenticated hits return `401 Missing X-Api-Key`, so the connector stays Unhealthy until you claim and set a Test Profile.

Do **not** email API keys to Glama support. Claim the connector and enter the key under Admin → Test Profile.

## 1. Claim ownership

1. Open the listing → **Claim** (sign in to Glama).
2. Pick one proof:

### Option A — DNS (fastest; no deploy)

Add the exact TXT record Glama shows (typically `_glama-claim.api.toolyour.com`), wait for propagation, then **Check**.

### Option B — HTTP file

1. Copy the `glama_claim_…` token from the dialog.
2. Set on **toolyour-mcp** (Railway/host): `GLAMA_CLAIM_TOKEN=<token>`
3. Deploy **toolyour-mcp** + reload **infra** nginx so `GET https://api.toolyour.com/.well-known/glama.json` is proxied (no redirect).
4. Confirm JSON:

```json
{
  "$schema": "https://glama.ai/mcp/schemas/connector.json",
  "claim": "glama_claim_..."
}
```

5. Click **Check** on Glama.

Keep the DNS record or env token in place — Glama rechecks daily.

## 2. Fix health check (after claim)

1. **Rotate** any key that was sent by email (dashboard → revoke old → create new).
2. Admin → **Test Profile** → add header `X-Api-Key` = new `ty_…` key.
3. Set connector URL to Streamable HTTP:

   `https://api.toolyour.com/mcp/http`

   (`POST /mcp` also speaks Streamable HTTP; Glama currently lists `/mcp`. Prefer `/mcp/http` for directory probes.)
4. Click **Test Connection** (don’t wait for the hourly job).

## 3. Unblock awesome-remote-mcp-servers

When the listing shows **Healthy**, reply on [punkpeye/awesome-remote-mcp-servers#1548](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/1548) (or the issue thread) that Glama is Healthy so they can merge.

## Env

| Variable | Purpose |
|----------|---------|
| `GLAMA_CLAIM_TOKEN` | Opaque claim token from Glama Claim dialog → `/.well-known/glama.json` |
