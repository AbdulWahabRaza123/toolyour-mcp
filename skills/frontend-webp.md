---
id: frontend-webp
title: Frontend WebP
category: seo
description: Convert compressible page images to WebP and list img/srcset replacements for SEO.
operationIds: pageSpeedAnalyzer, convertToWebp, folderToZip, zipExtract
workflowId: frontend-webp-job
---

# Frontend WebP Skill

Convert heavy PNG/JPEG assets on a live URL to WebP, then patch the repo.

## Preferred path

1. `plan_task("convert frontend images to webp for {url}")`
2. `run_playbook("frontend-webp", { url })`
3. Read `jobReport.workstreams.assets.pendingImages` and `convertedZip`
4. Host agent: drop the `.webp` files into the project, update `img` / `srcset` / `<picture>`
5. `verify_task` only when `loop.initiate` is true

## Optional pack / unpack

- Public image URLs → `convertToWebp({ urls })` (returns a zip of `.webp` files)
- Many local files after an upload URL exists → `folderToZip` then `convertToWebp` (zip of images is already supported)
- A zip URL → `zipExtract` returns per-file `downloadUrl`s (HTTP cannot return a filesystem folder)

Do not add a new converter catalog page for this job. `convertToWebp` is the conversion tool.
