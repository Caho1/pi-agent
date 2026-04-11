import { InteractiveMode, runPrintMode } from "@mariozechner/pi-coding-agent";

import { parseCliArgs } from "./cli-options.js";
import {
  createProjectRuntime,
  formatSkillSummary,
  getCredentialStatus,
  loadLocalEnv,
  loadProjectResources,
  printCredentialHints,
  projectRoot,
  showHelp
} from "./runtime.js";

async function runInteractiveChat(): Promise<void> {
  const resources = await loadProjectResources();

  console.log("pi Agent Demo");
  console.log(`project: ${projectRoot}`);
  console.log(`skills: ${formatSkillSummary(resources.skills)}`);
  if (resources.diagnostics.length > 0) {
    console.log(`skill warnings: ${resources.diagnostics.length}`);
  }
  console.log("");

  const runtime = await createProjectRuntime();
  const mode = new InteractiveMode(runtime, {
    migratedProviders: [],
    modelFallbackMessage: runtime.modelFallbackMessage,
    initialImages: [],
    initialMessages: [],
    verbose: true
  });

  await mode.run();
}

async function runOneShot(prompt: string): Promise<void> {
  const runtime = await createProjectRuntime();
  const exitCode = await runPrintMode(runtime, {
    mode: "text",
    initialMessage: prompt,
    initialImages: [],
    messages: []
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const { showHelp: helpRequested, prompt } = parseCliArgs(process.argv.slice(2));
  if (helpRequested) {
    showHelp();
    return;
  }

  const credentialStatus = getCredentialStatus();
  if (!credentialStatus.configured) {
    printCredentialHints(credentialStatus);
    process.exitCode = 1;
    return;
  }

  printCredentialHints(credentialStatus);

  if (prompt) {
    await runOneShot(prompt);
    return;
  }

  await runInteractiveChat();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
