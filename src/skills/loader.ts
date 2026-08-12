import fs from "fs";
import path from "path";
import { getEnv } from "../config";
import type { McpSkillMeta } from "../contracts";
import { skillWorkflowId } from "../orchestrator/playbook-map";

export type { EnrichedSkillMeta } from "./enrich";
export { enrichAllSkills, enrichSkillMeta, resolveSkillWorkflowId, skillForWorkflow } from "./enrich";

function parseFrontmatter(content: string): {
  meta: Record<string, string>;
  body: string;
} {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2] };
}

export function loadSkills(): McpSkillMeta[] {
  const env = getEnv();
  if (!fs.existsSync(env.skillsDir)) return [];

  const files = fs.readdirSync(env.skillsDir).filter((f) => f.endsWith(".md"));
  const skills: McpSkillMeta[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(env.skillsDir, file), "utf8");
    const { meta } = parseFrontmatter(raw);
    const id = meta.id || file.replace(/\.md$/, "");
    const operationIds = (meta.operationIds || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    skills.push({
      id,
      title: meta.title || id,
      category: meta.category || "general",
      description: meta.description || "",
      operationIds,
      workflowId: meta.workflowId || skillWorkflowId(id) || undefined,
    });
  }

  return skills;
}

export function loadSkillContent(skillId: string): string | null {
  const env = getEnv();
  const p = path.join(env.skillsDir, `${skillId}.md`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  const { body } = parseFrontmatter(raw);
  return body.trim();
}
