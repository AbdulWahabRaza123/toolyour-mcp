# Tier-1 golden paths (closable demos)

Goal: an MCP host agent finishes **plan → run → apply rank-1 → verify** without inventing tools.

Offline shape checks:

```bash
npm run build
node scripts/golden-path-tier1.mjs
```

Live smoke (needs `TOOLYOUR_API_KEY`):

```bash
# ship-gate style URL job (example.com usually fails headers → remainingFixes)
SMOKE_GOAL="ship gate for https://example.com" npm run smoke:live:agent

# or secrets paste via MCP client — see paths below
```

---

## 1) Ship-gate (cloud measure + agent config fix)

**Goal:** `ship gate for https://example.com` (or your preview URL)

| Step | Who | Action |
|------|-----|--------|
| 1 | MCP | `plan_task` → `run_playbook("ship-gate", { url })` or `solve_task` |
| 2 | Host | Read `loop.nextActions[0]` — usually `patchType: http-header` / `roleHint: config` |
| 3 | Host | Apply header/TLS/mixed fix on **your** server (example.com itself won’t accept your patch — use a URL you control for a true pass) |
| 4 | MCP | `verify_task` with baseline until `loop.gate` is pass or `loop.stop` |

**Demo note:** `example.com` is good to show **fail + remainingFixes**. For **gate=pass**, use a staging URL you can harden.

**Never:** localhost URL.

---

## 2) SEO audit

### Live URL

**Goal:** `seo audit https://example.com`

1. `plan_task` → `run_playbook("seo-site-audit", { url })`
2. Apply rank-1 (`patchType` often `html` / `roleHint: edit`) in templates
3. `verify_task` with same URL + baseline

### Local HTML (agent-first)

1. Host reads `index.html` from the repo into `input.html`
2. `run_playbook("content-ship", { html })` or `solve_task` with `input.html`
3. Edit HTML → re-pass `input.html` on verify

---

## 3) Secrets hygiene (agent-first payload)

**Dirty paste** (expect findings + fail gate):

```text
STRIPE_KEY=sk_live_51ABCDEFdeadbeefxxxx
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
```

1. `run_playbook("secrets-and-auth-hygiene", { text: "<paste>" })`
2. Host redacts/rotates (`roleHint: config`) — do not commit secrets
3. `verify_task` with **cleaned** `input.text` + baseline until gate pass

**Clean paste** (expect pass / no secret findings):

```text
APP_ENV=production
LOG_LEVEL=info
```

JWT-only pastes: jwtDecoder runs when a JWT is present; non-JWT pastes skip JWT without failing the job.

---

## Host contract reminder

- Apply **rank-1 only** between verifies  
- Full list: `loop.remainingFixes`  
- Stop on `loop.stop` — do not burn credits looping the same findings  
- Works for **any** MCP host (Cursor, Claude, …) — ToolYour does not replace the host  

See [HOST-CONTRACT.md](./HOST-CONTRACT.md).
