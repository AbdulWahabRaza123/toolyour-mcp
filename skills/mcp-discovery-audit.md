---
id: mcp-discovery-audit
title: MCP Discovery Audit
category: seo
description: Well-known MCP, OpenAPI, and llms.txt discovery probes at origin.
operationIds: mcpDiscoveryChecker, geoSeoAuditor
workflowId: mcp-discovery-audit-job
---

# MCP Discovery Audit Skill

1. `run_playbook("mcp-discovery-audit", { url })`
2. Fix /.well-known/mcp and /openapi.json before agent onboarding docs
3. API route only — no separate catalog page required
