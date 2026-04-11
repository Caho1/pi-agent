import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@mariozechner/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  defineTool,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
  type ModelRegistry,
  type ResourceDiagnostic,
  type Skill
} from "@mariozechner/pi-coding-agent";

import { searchJournalCatalog } from "./catalog.js";

export interface CredentialStatus {
  configured: boolean;
  usingStoredAuth: boolean;
}

export interface ProjectResources {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
            type: "text" as const,
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
      content: [{ type: "text" as const, text }],
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

export function showHelp(): void {
  console.log("Usage:");
  console.log("  npm run chat");
  console.log("  npm run chat -- \"your prompt here\"");
  console.log("  npm run demo");
}

export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(resolve(projectRoot, ".env"));
  } catch {
    // Local env file is optional; users can also rely on shell vars or auth.json.
  }
}

export function getCredentialStatus(): CredentialStatus {
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

  const hasEnvKey = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY"
  ].some((name) => Boolean(process.env[name]));

  return {
    configured: hasEnvKey || hasStoredAuth,
    usingStoredAuth: !hasEnvKey && hasStoredAuth
  };
}

export function printCredentialHints(status: CredentialStatus): void {
  if (!status.configured) {
    console.log("No common model API key was found in the current shell.");
    console.log("Set OPENAI_API_KEY or configure ~/.pi/agent/auth.json before running the chat demo.");
    console.log("");
    return;
  }

  if (status.usingStoredAuth) {
    console.log("Using pi credentials from ~/.pi/agent/auth.json.");
    console.log("");
  }
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

function createResourceLoaderOptions() {
  return {
    agentsFilesOverride: (current: { agentsFiles: Array<{ path: string; content: string }> }) => {
      const deduped = new Map(current.agentsFiles.map((file) => [file.path, file]));

      for (const file of loadExtraContextFiles()) {
        deduped.set(file.path, file);
      }

      return {
        agentsFiles: Array.from(deduped.values())
      };
    },
    skillsOverride: (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => ({
      skills: current.skills.filter((skill) => isProjectSkillPath(skill.filePath)),
      diagnostics: current.diagnostics
    }),
    systemPromptOverride: (basePrompt?: string) =>
      `${basePrompt ?? ""}\n\nIf a user request matches an available skill, read the relevant SKILL.md with the read tool before answering. Treat SOUL.md as the primary role/persona definition when present, and treat AGENT.md as the larger operating guideline file. For journal recommendation, scope matching, or submission strategy tasks, use the demo-journal-agent skill and call search_journals before giving advice.`
  };
}

export async function createProjectServices() {
  return createAgentSessionServices({
    cwd: projectRoot,
    agentDir: getAgentDir(),
    resourceLoaderOptions: createResourceLoaderOptions()
  });
}

export async function loadProjectResources(): Promise<ProjectResources> {
  const services = await createProjectServices();

  const { skills, diagnostics } = services.resourceLoader.getSkills();
  return { skills, diagnostics };
}

export function formatSkillSummary(skills: Skill[]): string {
  return skills.map((skill) => skill.name).join(", ") || "(none)";
}

export function getProjectModel(modelRegistry: Pick<ModelRegistry, "find">) {
  const model = modelRegistry.find("openai", "gpt-5.4");
  if (!model) {
    throw new Error("The configured model openai/gpt-5.4 is not available.");
  }

  return model;
}

export async function createProjectRuntime() {
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: createResourceLoaderOptions()
    });

    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model: getProjectModel(services.modelRegistry),
        customTools: [searchJournalsTool]
      })),
      services,
      diagnostics: services.diagnostics
    };
  };

  return createAgentSessionRuntime(createRuntime, {
    cwd: projectRoot,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(projectRoot)
  });
}
