# MCP off-site listing pack (2026)

Use this pack to get **editorial / directory mentions** of ToolYour as a remote MCP server. Do **not** buy PBNs or mass guest posts. Spam updates (incl. March 2026) punish manipulative links.

**Primary URLs to promote (in order):**

1. https://www.toolyour.com/developers/mcp  
2. https://www.toolyour.com/  
3. https://www.toolyour.com/developers/seo-agent  
4. https://www.toolyour.com/digital-tools/internal-linking (SEO wedge)

**Facts that must stay true:** 500 credits/month free (tools 1–10 credits); MCP = API-backed tools only (`hasApi`); plan → run → verify; does **not** replace Cursor/Claude host harness.

**Canonical registry file (shipped in repo):** [`toolyour-mcp/server.json`](../toolyour-mcp/server.json) — namespace `com.toolyour/mcp`, remotes `https://api.toolyour.com/mcp/http` (streamable-http) + SSE `/mcp`.

---

## 0) Official MCP Registry (do this first — 2026 path)

Directories (PulseMCP, many clients) ingest `registry.modelcontextprotocol.io`. ToolYour was **not** listed as of 2026-09-07 (`search=toolyour` → empty).

### Windows (one-time)

1. Download `mcp-publisher` from https://github.com/modelcontextprotocol/registry/releases (latest `mcp-publisher_*_windows_amd64.zip`).
2. Prove domain ownership for namespace `com.toolyour/*` (DNS login — preferred for product brand):

```powershell
# From a machine with mcp-publisher on PATH
cd d:\Jourey\Products\toolyour\toolyour-mcp
mcp-publisher login dns --domain toolyour.com
# Follow prompt: add the TXT record it prints at _mcp-publisher.toolyour.com (or as instructed)
mcp-publisher publish
```

Alternate: `mcp-publisher login github` only if you publish under `io.github.ToolYour/...` and change `name` in `server.json` to match.

3. Verify:

```text
https://registry.modelcontextprotocol.io/v0/servers?search=toolyour
```

4. Expedite aggregators after registry is live:
   - PulseMCP: email hello@pulsemcp.com with server name `com.toolyour/mcp`
   - Smithery: claim/manual submit at https://smithery.ai (login)
   - Glama: claim listing via GitHub when it appears

### Copy for registry (already in server.json description)

> Remote MCP: plan, run, verify for SEO/security/ship-gate. Same REST API key; 500 free credits/month.

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

## Submission checklist (manual)

Mark done when live with a dofollow or at least indexed mention + correct URL.

| Channel | Target URL | Status | Notes |
|---------|------------|--------|-------|
| **Official MCP Registry** | `com.toolyour/mcp` via `server.json` | [ ] | **Do first** — see section 0 |
| Smithery | `/developers/mcp` | [ ] | Claim after registry or manual submit |
| Glama | `/developers/mcp` | [ ] | Claim when crawled |
| PulseMCP | auto from registry | [ ] | Optional expedite email |
| GitHub ToolYour org README / awesome-mcp lists | `/developers/mcp` | [ ] | PR only where lists accept quality servers |
| Product Hunt / Indie Hackers (launch or update) | `/` or `/developers/mcp` | [ ] | Lead with MCP, not “200 tools” |
| Cursor forum / Claude community (honest how-to) | setup blogs + MCP | [ ] | Link `mcp-server-for-cursor-setup` / Claude setup |
| Niche SEO blog roundup (1–2) | `/digital-tools/internal-linking` | [ ] | “Internal link checker” phrasing |
| LinkedIn / X founder posts | `/developers/mcp` | [ ] | Same one-liner; not spammy threads |

**Avoid:** paid link networks, spun articles, claiming “all tools on MCP,” “500 requests,” or “replaces Cursor.”

---

## Suggested outreach email (short)

Subject: Remote MCP server for SEO / ship-gate agents

Hi {name},

ToolYour is a remote MCP endpoint agents use for plan → run → verify (SEO audits, security, ship-gate). Same key as our REST API; 500 free credits/month.

Setup: https://www.toolyour.com/developers/mcp  
If you maintain an MCP directory or tools list, happy to send a short factual blurb.

Thanks,  
{your name}

---

## Couple with Internal Link Checker

When a listing allows a **second** product URL (SEO tools, free tools roundups), use:

- Anchor: **Internal Link Checker**  
- URL: https://www.toolyour.com/digital-tools/internal-linking  
- One line: Bounded crawl for internal link graph, orphan signals, and broken destinations — browser free; agents via MCP SEO playbooks.

---

## Measure

After 2–4 weeks of listings:

```powershell
cd toolyour-apis
npm run export:ranking-gsc-baseline -- --days=28
```

Watch: homepage + `/developers/mcp` clicks; query `internal link checker` position.
