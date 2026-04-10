import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  createReadOnlyTools,
  DefaultResourceLoader,
  defineTool,
  SessionManager
} from "@mariozechner/pi-coding-agent";

import { searchJournalCatalog } from "./catalog.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extraContextFileNames = ["AGENT.md", "SOUL.md"];
const projectSkillRoots = [resolve(projectRoot, ".pi", "skills"), resolve(projectRoot, ".agents", "skills")];

const searchJournalsTool = defineTool({
  name: "search_journals",
  label: "Search Journals",
  description: "Search the local journal catalog and return the best matching venues for a paper topic or submission strategy.",
  promptSnippet: "`search_journals`: search the local journal catalog by topic, quartile, open-access preference, APC, and turnaround time.",
  promptGuidelines: [
    "When the user asks for journal recommendations or submission strategy, call `search_journals` before making claims.",
    "Do not invent journal metrics that are not present in the tool result."
  ],
  parameters: Type.Object({
    query: Type.String({ description: "Paper topic, abstract excerpt, or search intent." }),
    quartile: Type.Optional(Type.String({ description: "Optional quartile filter, such as Q1 or Q2." })),
    openAccessOnly: Type.Optional(Type.Boolean({ description: "Set to true when the user requires open access journals only." })),
    maxApcUsd: Type.Optional(Type.Number({ description: "Maximum APC budget in USD." })),
    maxTurnaroundDays: Type.Optional(Type.Number({ description: "Maximum acceptable review turnaround in days." })),
    limit: Type.Optional(Type.Number({ description: "How many candidate journals to return. Default is 3." }))
  }),
  async execute(_toolCallId, params) {
    const matches = searchJournalCatalog(params);

    if (matches.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No matching journals were found in the demo catalog. Broaden the query or relax the filters."
          }
        ],
        details: { matches: [] }
      };
    }

    const text = matches
      .map((match, index) => {
        const { journal } = match;
        const matched = match.matchedKeywords.length > 0 ? match.matchedKeywords.join(", ") : "broad scope fit";

        return [
          `${index + 1}. ${journal.name}`,
          `quartile: ${journal.quartile}`,
          `open_access: ${journal.openAccess ? "yes" : "no"}`,
          `apc_usd: ${journal.apcUsd}`,
          `turnaround_days: ${journal.turnaroundDays}`,
          `scope: ${journal.scope}`,
          `note: ${journal.note}`,
          `matched_keywords: ${matched}`
        ].join("\n");
      })
      .join("\n\n");

    return {
      content: [{ type: "text", text }],
      details: {
        matches: matches.map((match) => ({
          journal: match.journal,
          score: match.score,
          matchedKeywords: match.matchedKeywords
        }))
      }
    };
  }
});

function hasConfiguredCredentials(): boolean {
  const authFile = resolve(homedir(), ".pi", "agent", "auth.json");
  const hasStoredAuth =
    existsSync(authFile) &&
    (() => {
      try {
        const parsed = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, unknown>;
        return Object.keys(parsed).length > 0;
      } catch {
        return false;
      }
    })();

  return (
    [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY",
      "OPENROUTER_API_KEY"
    ].some((name) => Boolean(process.env[name])) || hasStoredAuth
  );
}

function printStartupHints(): boolean {
  const configured = hasConfiguredCredentials();

  const hasEnvKey = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY"
  ].some((name) => Boolean(process.env[name]));

  if (!configured) {
    console.log("No common model API key was found in the current shell.");
    console.log("Set OPENAI_API_KEY or configure ~/.pi/agent/auth.json before running the chat demo.");
    console.log("");
  }

  if (!hasEnvKey && configured) {
    console.log("Using pi credentials from ~/.pi/agent/auth.json.");
    console.log("");
  }

  return configured;
}

function showHelp(): void {
  console.log("Usage:");
  console.log("  npm run chat");
  console.log("  npm run chat -- \"your prompt here\"");
  console.log("  npm run demo");
}

function loadExtraContextFiles() {
  return extraContextFileNames.flatMap((fileName) => {
    const path = resolve(projectRoot, fileName);
    if (!existsSync(path)) {
      return [];
    }

    return [
      {
        path,
        content: readFileSync(path, "utf8")
      }
    ];
  });
}

function isProjectSkillPath(filePath: string): boolean {
  return projectSkillRoots.some((root) => filePath.startsWith(root));
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
    return;
  }

  try {
    process.loadEnvFile(resolve(projectRoot, ".env"));
  } catch {
    // Local env file is optional; users can also rely on shell vars or auth.json.
  }

  const configuredCredentials = printStartupHints();

  const resourceLoader = new DefaultResourceLoader({
    cwd: projectRoot,
    agentsFilesOverride: (current) => {
      const deduped = new Map(current.agentsFiles.map((file) => [file.path, file]));

      for (const file of loadExtraContextFiles()) {
        deduped.set(file.path, file);
      }

      return {
        agentsFiles: Array.from(deduped.values())
      };
    },
    skillsOverride: (current) => ({
      skills: current.skills.filter((skill) => isProjectSkillPath(skill.filePath)),
      diagnostics: current.diagnostics
    }),
    systemPromptOverride: (basePrompt) =>
      `${basePrompt}\n\nIf a user request matches an available skill, read the relevant SKILL.md with the read tool before answering. Treat SOUL.md as the primary role/persona definition when present, and treat AGENT.md as the larger operating guideline file. For journal recommendation, scope matching, or submission strategy tasks, use the demo-journal-agent skill and call search_journals before giving advice.`
  });
  await resourceLoader.reload();

  const { skills, diagnostics } = resourceLoader.getSkills();
  console.log("pi Agent Demo");
  console.log(`project: ${projectRoot}`);
  console.log(`skills: ${skills.map((skill) => skill.name).join(", ") || "(none)"}`);
  if (diagnostics.length > 0) {
    console.log(`skill warnings: ${diagnostics.length}`);
  }
  console.log("Type `exit` to quit.");
  console.log("");

  if (!configuredCredentials) {
    process.exitCode = 1;
    return;
  }

  const { session } = await createAgentSession({
    cwd: projectRoot,
    resourceLoader,
    tools: createReadOnlyTools(projectRoot),
    customTools: [searchJournalsTool],
    sessionManager: SessionManager.inMemory()
  });

  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }

    if (event.type === "tool_execution_start") {
      console.log(`\n[tool:start] ${event.toolName}`);
    }

    if (event.type === "tool_execution_end") {
      const status = event.isError ? "error" : "ok";
      console.log(`\n[tool:end] ${event.toolName} (${status})`);
    }

    if (event.type === "agent_end") {
      process.stdout.write("\n\n");
    }
  });

  const oneShotPrompt = process.argv.slice(2).join(" ").trim();
  if (oneShotPrompt) {
    await session.prompt(oneShotPrompt);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const prompt = (await rl.question("you> ")).trim();
      if (!prompt) {
        continue;
      }

      if (["exit", "quit", "/exit"].includes(prompt.toLowerCase())) {
        break;
      }

      console.log("agent> ");
      await session.prompt(prompt);
    }
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
