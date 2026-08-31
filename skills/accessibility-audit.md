---
id: accessibility-audit
title: Accessibility Audit
category: seo
description: Image alt, heading structure, and WCAG HTML heuristics — not axe/Lighthouse.
operationIds: imageAltTextChecker,headingStructureAnalyzer,accessibilityAuditor
workflowId: accessibility-audit-job
---

# Accessibility Audit Skill

1. `plan_task("accessibility audit for https://…")`
2. `run_playbook("accessibility-audit", { url })`
3. Fix alt text, heading order, form labels, and html lang first

Not a replacement for axe-core or manual WCAG certification.
