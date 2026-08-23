import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  explicitLiveUrlIntent,
  localEquivalentTaskId,
  payloadFirstIntent,
} from "../../dist/orchestrator/payload-intent.js";
import {
  isConfidentMatch,
  matchTask,
} from "../../dist/orchestrator/match-task.js";
import { loadTasks } from "../../dist/orchestrator/task-registry.js";
import { planTask } from "../../dist/orchestrator/plan-task.js";
import { solveTask } from "../../dist/orchestrator/solve-task.js";
import { runPlaybook } from "../../dist/orchestrator/run-playbook.js";
import { loadSkills, enrichAllSkills, skillForWorkflow } from "../../dist/skills/loader.js";
import { RegistryLoader } from "../../dist/registry/loader.js";
import { createLogger } from "../../dist/observability/logger.js";
import { defsCache } from "../../dist/registry/defs-cache.js";

function ctx() {
  const registry = new RegistryLoader(createLogger("error"));
  registry.reload(true);
  return {
    apiKey: "ty_test",
    mcpSessionId: "revalidate",
    registry,
    logger: createLogger("error"),
  };
}

describe("payload-first routing contract", () => {
  defsCache.reload(true);
  const tasks = loadTasks();

  it("loads pr-code-gate as a runnable secrets-hygiene alias", () => {
    const skills = enrichAllSkills(loadSkills());
    const skill = skills.find((s) => s.id === "pr-code-gate");
    assert.ok(skill);
    assert.equal(skill.workflowId, "secrets-hygiene-job");
    assert.equal(skill.runnable, true);
    assert.equal(skill.verifyOnly, false);

    const canonical = skillForWorkflow("secrets-hygiene-job", skills);
    assert.ok(canonical);
    assert.notEqual(canonical.id, "pr-code-gate");

    const preferred = skillForWorkflow("secrets-hygiene-job", skills, "pr-code-gate");
    assert.equal(preferred?.id, "pr-code-gate");
  });

  it("routes payload vs live URL goals", () => {
    const cases = [
      ["ship this PR before merge", "pr-code-gate"],
      ["audit this html before deploy", "seo-audit-local"],
      ["ship this html before publish", "content-ship-local"],
      ["ship gate for https://example.com", "ship-gate"],
      ["full seo audit https://example.com", "seo-audit"],
      ["local SEO audit of this HTML", "seo-audit-local"],
    ];
    for (const [goal, expected] of cases) {
      const match = matchTask(goal, tasks);
      assert.equal(match?.task.id, expected, `${goal} → ${match?.task.id}`);
      assert.equal(isConfidentMatch(goal, tasks, match), true, goal);
    }
  });

  it("does not treat fetch-only tools as local file jobs", () => {
    assert.equal(localEquivalentTaskId("page-speed"), undefined);
    assert.equal(explicitLiveUrlIntent("run Lighthouse on the preview"), true);
    assert.equal(payloadFirstIntent("ship this PR before merge"), true);
    assert.equal(explicitLiveUrlIntent("ship this PR before merge"), false);
  });

  it("solve_task asks for files on PR goals, not a URL", async () => {
    const result = await solveTask("ship this PR before merge", {}, ctx());
    assert.equal(result.status, "need_input");
    assert.equal(result.matchedTask?.id, "pr-code-gate");
    assert.deepEqual(result.missing, ["text", "code", "html"]);
    assert.match(String(result.message), /workspace files|Do not ask for a public URL/i);
    assert.equal(/extract a url/i.test(JSON.stringify(result)), false);
  });

  it("plan_task next strings are intent-aware", () => {
    const registry = ctx().registry;
    const pr = planTask("ship this PR before merge", {}, registry);
    assert.match(String(pr.next), /workspace|input\.(text|html|code)/i);
    assert.equal(/extract a url/i.test(String(pr.next)), false);
    if (pr.recommended) {
      assert.ok(
        pr.recommended.id === "pr-code-gate" ||
          pr.recommended.workflowId === "secrets-hygiene-job"
      );
    }

    const live = planTask("ship gate for https://example.com", {}, registry);
    assert.match(String(live.next), /https:\/\//i);

    const siteSeo = planTask("SEO audit this site", {}, registry);
    assert.equal(siteSeo.loop.initiate, false);
    assert.equal(siteSeo.recommended?.kind, "playbook");
    assert.notEqual(siteSeo.recommended?.id, "seo-audit-local");
    assert.match(String(siteSeo.next), /https:\/\//i);
    assert.equal(/Do not ask for a public URL/i.test(String(siteSeo.next)), false);

    const siteSec = planTask("security audit my website", {}, registry);
    assert.equal(siteSec.loop.initiate, false);
    assert.match(String(siteSec.next), /https:\/\//i);
    assert.equal(/Do not ask for a public URL/i.test(String(siteSec.next)), false);
  });

  it("run_playbook pr-code-gate without files asks for payload", async () => {
    const result = await runPlaybook("pr-code-gate", {}, ctx());
    assert.equal(result.status, "need_input");
    assert.equal(/extract a url/i.test(JSON.stringify(result)), false);
    assert.match(String(result.message), /workspace files|Do not ask for a public URL/i);
  });

  it("run_playbook ship-gate without url asks for a live URL", async () => {
    const result = await runPlaybook("ship-gate", {}, ctx());
    assert.equal(result.status, "need_input");
    assert.ok(result.missing?.includes("url"));
    assert.match(String(result.message), /live|url|https/i);
  });
});
