import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { discoverAgentsFromDirs, formatAgentList } from "../.pi/extensions/subagent/agents.js";
import { resolvePiInvocation } from "../.pi/extensions/subagent/invocation.js";

test("discoverAgentsFromDirs merges user and project agents with project override", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-agent-subagent-"));
  const userDir = join(root, "user-agents");
  const projectDir = join(root, "project", ".pi", "agents");

  mkdirSync(userDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  writeFileSync(
    join(userDir, "worker.md"),
    `---
name: worker
description: user worker
model: openai/gpt-5.4
---

User worker prompt.
`
  );
  writeFileSync(
    join(projectDir, "worker.md"),
    `---
name: worker
description: project worker
model: openai/gpt-5.4
---

Project worker prompt.
`
  );
  writeFileSync(
    join(projectDir, "reviewer.md"),
    `---
name: reviewer
description: project reviewer
tools: read, grep, find, ls
model: openai/gpt-5.4
---

Project reviewer prompt.
`
  );

  const both = discoverAgentsFromDirs({
    cwd: join(root, "project"),
    scope: "both",
    userDir,
    projectAgentsDir: projectDir
  });

  assert.equal(both.projectAgentsDir, projectDir);
  assert.equal(both.agents.length, 2);
  assert.equal(both.agents.find((agent) => agent.name === "worker")?.source, "project");
  assert.equal(both.agents.find((agent) => agent.name === "worker")?.description, "project worker");
  assert.equal(both.agents.find((agent) => agent.name === "reviewer")?.source, "project");

  const listed = formatAgentList(both.agents, 1);
  assert.match(listed.text, /(worker|reviewer)/);
  assert.equal(listed.remaining, 1);

  await rm(root, { recursive: true, force: true });
});

test("resolvePiInvocation prefers repo-local pi binary and falls back to package/global pi", () => {
  const args = ["--mode", "json", "-p", "Task: hello"];

  const local = resolvePiInvocation(args, {
    cwd: "/repo",
    localPiPath: "/repo/node_modules/.bin/pi",
    packageCliPath: "/repo/node_modules/@mariozechner/pi-coding-agent/dist/cli.js"
  });
  assert.equal(local.command, "/repo/node_modules/.bin/pi");
  assert.deepEqual(local.args, args);

  const packaged = resolvePiInvocation(args, {
    cwd: "/repo",
    localPiPath: undefined,
    packageCliPath: "/repo/node_modules/@mariozechner/pi-coding-agent/dist/cli.js"
  });
  assert.equal(packaged.command, process.execPath);
  assert.deepEqual(packaged.args, ["/repo/node_modules/@mariozechner/pi-coding-agent/dist/cli.js", ...args]);

  const global = resolvePiInvocation(args, {
    cwd: "/repo",
    localPiPath: undefined,
    packageCliPath: undefined
  });
  assert.equal(global.command, "pi");
  assert.deepEqual(global.args, args);
});

test("bundled project agents and workflow prompts are present and pinned to gpt-5.4", async () => {
  const both = discoverAgentsFromDirs({
    cwd: process.cwd(),
    scope: "project",
    userDir: join(process.cwd(), "does-not-exist"),
    projectAgentsDir: join(process.cwd(), ".pi", "agents")
  });

  const names = both.agents.map((agent) => agent.name).sort();
  assert.deepEqual(names, ["planner", "reviewer", "scout", "worker"]);

  for (const agent of both.agents) {
    assert.equal(agent.model, "openai/gpt-5.4");
    assert.ok(agent.systemPrompt.trim().length > 0);
  }

  const promptsDir = join(process.cwd(), ".pi", "prompts");
  const expectedPrompts = ["implement.md", "implement-and-review.md", "scout-and-plan.md"];

  for (const fileName of expectedPrompts) {
    await assert.doesNotReject(async () => {
      const path = join(promptsDir, fileName);
      const contents = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
      assert.ok(contents.includes("subagent tool"));
    });
  }
});
