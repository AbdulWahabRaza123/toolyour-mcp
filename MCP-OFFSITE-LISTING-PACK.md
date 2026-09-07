# MCP off-site listing pack (2026)

Use this pack to get **editorial / directory mentions** of ToolYour as a remote MCP server. Do **not** buy PBNs or mass guest posts. Spam updates (incl. March 2026) punish manipulative links.

**Primary URLs to promote (in order):**

1. https://www.toolyour.com/developers/mcp  
2. https://www.toolyour.com/  
3. https://www.toolyour.com/developers/seo-agent  
4. https://www.toolyour.com/digital-tools/internal-linking (SEO wedge)

**Facts that must stay true:** 500 credits/month free (tools 1–10 credits); MCP = API-backed tools only (`hasApi`); plan → run → verify; does **not** replace Cursor/Claude host harness.

**Canonical registry file:** [`toolyour-mcp/server.json`](../toolyour-mcp/server.json) — namespace `com.toolyour/mcp` **v1.0.1** (live on Official Registry since 2026-09-07).

---

## 0) Official MCP Registry — DONE

Live: https://registry.modelcontextprotocol.io/v0/servers?search=toolyour

DNS auth keypair lives locally at `toolyour-mcp/.tools/dns-auth/` (gitignored). To republish after `server.json` edits:

```powershell
cd d:\Jourey\Products\toolyour\toolyour-mcp
$pk = (Get-Content .\.tools\dns-auth\private.hex -Raw).Trim()
.\.tools\mcp-publisher.exe login dns --domain toolyour.com --private-key $pk
.\.tools\mcp-publisher.exe publish
```

### Aggregators (after registry)

| Channel | Action | Status |
|---------|--------|--------|
| PulseMCP | Auto-ingest (~days). Expedite: send [`docs/PULSEMCP-EXPEDITE-EMAIL.md`](./PULSEMCP-EXPEDITE-EMAIL.md) to hello@pulsemcp.com | [ ] email |
| Smithery | Sign in → https://smithery.ai/servers/new (or claim when crawled) | [ ] manual login |
| Glama | Wait for crawl / claim via GitHub when listed | [ ] wait |

---

## One-liner (paste anywhere)

> ToolYour is a remote MCP server for AI agents: plan work, run SEO/security/ship-gate playbooks, and verify until checks pass — same API key and credits as REST.

## Short blurb (≤280 chars)

> Remote MCP for Cursor & Claude: plan → run → verify. SEO audits, security checks, and ship-gate on one API key shared with REST. Free tier: 500 credits/month.

## Directory / listing blurb (≤500 chars)

> ToolYour connects Cursor, Claude, and other MCP clients to a remote HTTPS MCP endpoint. Agents plan the job, run playbooks or solve goals, then verify until the gate passes (or stop). Primary jobs: ship-gate, SEO audits, security audits. Developers use the same capabilities over REST. Browser tools are for human smoke-checks. One `X-Api-Key`, one monthly credit quota (500 free credits/month; tools cost 1–10 credits). MCP exposes API-backed catalog tools only — not every browser-only utility.

## Setup snippet (Cursor / Claude)

```text
Remote MCP URL: https://api.toolyour.com/mcp
Streamable HTTP: https://api.toolyour.com/mcp/http
Auth: X-Api-Key (dashboard API key, prefix ty_)
Docs: https://www.toolyour.com/developers/mcp
```

---

## Submission checklist

| Channel | Target URL | Status | Notes |
|---------|------------|--------|-------|
| **Official MCP Registry** | `com.toolyour/mcp` | [x] | v1.0.1 published 2026-09-07 |
| PulseMCP | auto from registry | [ ] | Send expedite email |
| Smithery | `/developers/mcp` | [ ] | Login required at smithery.ai/servers/new |
| Glama | `/developers/mcp` | [ ] | Wait / claim |
| GitHub README / awesome-mcp lists | `/developers/mcp` | [ ] | Optional PR |
| Product Hunt / Indie Hackers | `/` or `/developers/mcp` | [ ] | Lead with MCP |
| Cursor / Claude community how-to | setup blogs + MCP | [ ] | Already have Cursor/Claude setup blogs |
| Niche SEO roundup (1–2) | `/digital-tools/internal-linking` | [ ] | Couple with ILC blog |
| LinkedIn / X founder posts | `/developers/mcp` | [ ] | Same one-liner |

**Avoid:** paid link networks, spun articles, claiming “all tools on MCP,” “500 requests,” or “replaces Cursor.”

---

## Couple with Internal Link Checker

- Anchor: **Internal Link Checker**  
- URL: https://www.toolyour.com/digital-tools/internal-linking  
- Blog: https://www.toolyour.com/blogs/internal-link-checker-tool (Request indexing — unknown to Google as of 2026-09-07)

---

## Measure

After 2–4 weeks:

```powershell
cd toolyour-apis
npm run export:ranking-gsc-baseline -- --days=28
npm run inspect:tier0-gsc-urls
```

Watch: homepage + `/developers/mcp` clicks; query `internal link checker` position; ILC blog indexation.
