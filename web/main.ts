import { Type, getModel, type Model } from "@mariozechner/pi-ai";
import { Agent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
import {
  AppStorage,
  ChatPanel,
  CustomProvidersStore,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  defaultConvertToLlm,
  setAppStorage
} from "@mariozechner/pi-web-ui";
import "@mariozechner/pi-web-ui/app.css";

import soulText from "../SOUL.md?raw";
import agentGuideText from "../AGENT.md?raw";
import { searchJournalCatalog } from "../src/catalog.js";
import "./app.css";

const skillModules = import.meta.glob("../.pi/skills/*/SKILL.md", {
  eager: true,
  import: "default",
  query: "?raw"
}) as Record<string, string>;

type SkillDefinition = {
  id: string;
  command: string;
  content: string;
  summary: string;
};

type SlashCommandResult =
  | { type: "plain"; prompt: string }
  | { type: "activate"; prompt: string; skill: SkillDefinition }
  | { type: "clear"; prompt: string };

type SlashCommandOption = {
  command: string;
  summary: string;
  kind: "skill" | "builtin";
  skillId?: string;
};

type ShellRefs = {
  chatHost: HTMLElement;
  activeSkillBadge: HTMLElement;
};

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[\s\S]*?---\s*/u, "").trim();
}

function extractSkillSummary(markdown: string): string {
  const lines = stripFrontmatter(markdown)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const summaryLine =
    lines.find((line) => !line.startsWith("#") && !line.startsWith("```") && !line.startsWith("-")) ??
    lines[0] ??
    "Project-local skill";

  return summaryLine.length > 90 ? `${summaryLine.slice(0, 87)}...` : summaryLine;
}

const projectSkills: SkillDefinition[] = Object.entries(skillModules)
  .map(([path, content]) => {
    const match = path.match(/\/([^/]+)\/SKILL\.md$/u);
    if (!match) {
      throw new Error(`Could not determine skill id from path: ${path}`);
    }

    const id = match[1];
    return {
      id,
      command: id,
      content: content.trim(),
      summary: extractSkillSummary(content)
    };
  })
  .sort((left, right) => left.command.localeCompare(right.command));

const skillsByCommand = new Map(projectSkills.map((skill) => [skill.command.toLowerCase(), skill]));
const slashCommandOptions: SlashCommandOption[] = [
  ...projectSkills.map((skill) => ({
    command: skill.command,
    summary: skill.summary,
    kind: "skill" as const,
    skillId: skill.id
  })),
  {
    command: "clear",
    summary: "清除当前 active skill，回到普通对话。",
    kind: "builtin" as const
  }
];
const slashCommandOptionsByCommand = new Map(slashCommandOptions.map((option) => [option.command.toLowerCase(), option]));
const INVISIBLE_MARKER = "\u200D";

function buildSystemPrompt(activeSkill: SkillDefinition | null): string {
  const availableSkillsSection =
    projectSkills.length === 0
      ? "No project-local skills are currently installed."
      : projectSkills.map((skill) => `- /${skill.command}: ${skill.summary}`).join("\n");

  const lines = [
    "You are a configurable project agent.",
    "Follow the persona, operating guide, and active skill below.",
    "",
    "<SOUL>",
    stripFrontmatter(soulText),
    "</SOUL>",
    "",
    "<AGENT_GUIDELINES>",
    agentGuideText.trim(),
    "</AGENT_GUIDELINES>",
    "",
    "<AVAILABLE_SKILLS>",
    availableSkillsSection,
    "</AVAILABLE_SKILLS>",
    "",
    "Operational rules:",
    "- If ACTIVE_SKILL is present, follow it as the primary workflow for the current task.",
    "- If no ACTIVE_SKILL is present, rely on SOUL.md and AGENT.md only; do not pretend a hidden skill is active.",
    "- Only use `search_journals` for journal recommendation, venue selection, or submission-planning tasks.",
    "- Keep answers concise, practical, and constraint-aware."
  ];

  if (activeSkill) {
    lines.push(
      "",
      `<ACTIVE_SKILL name="${activeSkill.id}" command="/${activeSkill.command}">`,
      activeSkill.content,
      "</ACTIVE_SKILL>"
    );
  }

  return lines.join("\n");
}

function createRightCodesModel(): Model<any> {
  const baseModel = getModel("openai", "gpt-5.4");
  if (!baseModel) {
    throw new Error("The built-in model openai/gpt-5.4 is not available.");
  }

  return {
    ...baseModel,
    provider: "right-codes",
    baseUrl: new URL("/api/right-codes", window.location.origin).toString(),
    name: "gpt-5.4 via right.codes"
  };
}

const searchJournalsTool: AgentTool<any, any> = {
  name: "search_journals",
  label: "Search Journals",
  description: "Search the local journal catalog by topic, quartile, APC, open-access preference, and review speed.",
  parameters: Type.Object({
    query: Type.String({ description: "Paper topic, abstract, or search intent." }),
    quartile: Type.Optional(Type.String({ description: "Optional quartile filter such as Q1." })),
    openAccessOnly: Type.Optional(Type.Boolean({ description: "Whether only open-access journals should be returned." })),
    maxApcUsd: Type.Optional(Type.Number({ description: "Maximum APC budget in USD." })),
    maxTurnaroundDays: Type.Optional(Type.Number({ description: "Maximum acceptable review turnaround in days." })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of journal candidates to return." }))
  }),
  async execute(_toolCallId, params) {
    const matches = searchJournalCatalog(params);
    if (matches.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No journals matched the current query in the local demo catalog. Try a broader topic or relax the filters."
          }
        ],
        details: { matches: [] }
      };
    }

    return {
      content: [
        {
          type: "text",
          text: matches
            .map((match, index) => {
              const { journal } = match;
              return [
                `${index + 1}. ${journal.name}`,
                `quartile: ${journal.quartile}`,
                `open_access: ${journal.openAccess ? "yes" : "no"}`,
                `apc_usd: ${journal.apcUsd}`,
                `turnaround_days: ${journal.turnaroundDays}`,
                `scope: ${journal.scope}`,
                `note: ${journal.note}`,
                `matched_keywords: ${match.matchedKeywords.join(", ") || "broad fit"}`
              ].join("\n");
            })
            .join("\n\n")
        }
      ],
      details: {
        matches: matches.map((match) => ({
          journal: match.journal,
          score: match.score,
          matchedKeywords: match.matchedKeywords
        }))
      }
    };
  }
};

function parseSlashCommand(input: string): SlashCommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { type: "plain", prompt: input };
  }

  const commandMatch = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/u);
  if (!commandMatch) {
    return { type: "plain", prompt: input };
  }

  const [, rawCommand, rest = ""] = commandMatch;
  const command = rawCommand.toLowerCase();

  if (command === "clear" || command === "none" || command === "skill-off") {
    return { type: "clear", prompt: rest.trim() };
  }

  const skill = skillsByCommand.get(command);
  if (!skill) {
    return { type: "plain", prompt: input };
  }

  return {
    type: "activate",
    prompt: rest.trim(),
    skill
  };
}

function isSinglePromptMessage(value: unknown): value is AgentMessage & { content: unknown } {
  return typeof value === "object" && value !== null && "role" in value && "content" in value;
}

function getPromptMessageText(message: AgentMessage & { content: unknown }): string | null {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const textItem = message.content.find(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        (item as { type?: string }).type === "text" &&
        "text" in item &&
        typeof (item as { text?: unknown }).text === "string"
    );

    return textItem?.text ?? null;
  }

  return null;
}

function replacePromptMessageText(message: AgentMessage & { content: unknown }, nextText: string): AgentMessage {
  if (typeof message.content === "string") {
    return { ...message, content: nextText } as AgentMessage;
  }

  if (Array.isArray(message.content)) {
    let replaced = false;
    const nextContent = message.content.map((item) => {
      if (
        !replaced &&
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        (item as { type?: string }).type === "text"
      ) {
        replaced = true;
        return {
          ...item,
          text: nextText
        };
      }

      return item;
    });

    if (!replaced) {
      nextContent.unshift({ type: "text", text: nextText });
    }

    return {
      ...message,
      content: nextContent
    } as AgentMessage;
  }

  return message;
}

function buildActivationPrompt(skill: SkillDefinition): string {
  return `你刚刚通过 /${skill.command} 激活了技能。请用中文简短确认已切换到这个 skill，并问用户希望你用它完成什么任务。`;
}

function buildClearPrompt(): string {
  return "当前 skill 已清除。请用中文简短确认，并问用户接下来希望你处理什么。";
}

async function bootstrapStorage() {
  const settings = new SettingsStore();
  const providerKeys = new ProviderKeysStore();
  const sessions = new SessionsStore();
  const customProviders = new CustomProvidersStore();

  const backend = new IndexedDBStorageBackend({
    dbName: "pi-agent-demo-web",
    version: 1,
    stores: [
      settings.getConfig(),
      providerKeys.getConfig(),
      customProviders.getConfig(),
      sessions.getConfig(),
      SessionsStore.getMetadataConfig()
    ]
  });

  settings.setBackend(backend);
  providerKeys.setBackend(backend);
  customProviders.setBackend(backend);
  sessions.setBackend(backend);

  const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
  setAppStorage(storage);

  // Avoid browser-side API-key prompts: the Vite proxy injects the real key server-side.
  await providerKeys.set("right-codes", "local-proxy");

  return storage;
}

function createShell(skills: SkillDefinition[]): ShellRefs {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("Missing #app container");
  }

  const commandDeck = [
    ...skills.map(
      (skill) => `
        <button
          type="button"
          class="command-pill"
          data-command-trigger="${skill.command}"
          data-skill-command="${skill.id}"
        >
          /${skill.command}
        </button>
      `
    ),
    `
      <button
        type="button"
        class="command-pill command-pill-secondary"
        data-command-trigger="clear"
      >
        /clear
      </button>
    `
  ].join("");

  app.innerHTML = `
    <div class="shell">
      <div class="layout">
        <main class="chat-card">
          <header class="chat-header">
            <div class="hero-copy">
              <div class="eyebrow">Agent</div>
              <h1 class="hero-title">Pi Agent Workspace</h1>
              <p class="hero-subtitle">GPT-5.4 · right.codes</p>
            </div>
            <div class="hero-meta">
              <div class="meta-card">
                <span class="meta-label">Model</span>
                <strong>GPT-5.4</strong>
              </div>
              <div class="meta-card">
                <span class="meta-label">Skills</span>
                <strong>${skills.length}</strong>
              </div>
              <div class="status-note" id="active-skill-badge">Idle</div>
            </div>
          </header>
          <section class="command-strip">
            <div class="command-strip-head">
              <span class="command-strip-label">Slash Commands</span>
              <span class="command-strip-hint">Type <code>/</code> or tap a mode</span>
            </div>
            <div class="command-deck">
              ${commandDeck}
            </div>
          </section>
          <div class="chat-body">
            <div class="chat-panel-shell">
              <div class="chat-panel-host" id="chat-panel-host"></div>
            </div>
          </div>
        </main>
      </div>
    </div>
  `;

  const chatHost = document.getElementById("chat-panel-host");
  const activeSkillBadge = document.getElementById("active-skill-badge");

  if (!chatHost || !activeSkillBadge) {
    throw new Error("Missing chat host container");
  }

  return {
    chatHost,
    activeSkillBadge
  };
}

function syncActiveSkillUi(activeSkill: SkillDefinition | null, shellRefs: ShellRefs) {
  shellRefs.activeSkillBadge.textContent = activeSkill
    ? `/${activeSkill.command}`
    : "Idle";
  shellRefs.activeSkillBadge.classList.toggle("is-active", activeSkill !== null);

  document.querySelectorAll<HTMLElement>("[data-skill-command]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.skillCommand === activeSkill?.id);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function filterSlashCommands(query: string): SlashCommandOption[] {
  const normalized = query.trim().toLowerCase();
  const startsWith = slashCommandOptions.filter((option) => option.command.startsWith(normalized));
  const includes = slashCommandOptions.filter(
    (option) => !option.command.startsWith(normalized) && option.command.includes(normalized)
  );
  return [...startsWith, ...includes];
}

function getSlashQuery(value: string, caret: number): string | null {
  if (caret !== value.length) {
    return null;
  }

  if (!value.startsWith("/")) {
    return null;
  }

  const firstLine = value.split("\n", 1)[0];
  if (firstLine.includes(" ")) {
    return null;
  }

  return firstLine.slice(1).toLowerCase();
}

function setTextareaValue(textarea: HTMLTextAreaElement, nextValue: string, caret: number) {
  textarea.value = nextValue;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function stripInvisibleMarkers(value: string): string {
  return value.replaceAll(INVISIBLE_MARKER, "");
}

function findSlashCommandOption(command: string): SlashCommandOption | undefined {
  return slashCommandOptionsByCommand.get(command.toLowerCase());
}

function extractLeadingSlashCommand(value: string): { option: SlashCommandOption; rest: string } | null {
  const match = value.match(/^\/([^\s]+)\s+([\s\S]*)$/u);
  if (!match) {
    return null;
  }

  const [, rawCommand, rest] = match;
  const option = findSlashCommandOption(rawCommand);
  if (!option) {
    return null;
  }

  return { option, rest };
}

function setupSlashCommandAutocomplete(chatPanel: ChatPanel) {
  let cleanupTextarea = () => {};
  let observedTextarea: HTMLTextAreaElement | null = null;
  let pendingCommand: SlashCommandOption | null = null;
  let sendMessageWrapped = false;

  const attachToTextarea = (textarea: HTMLTextAreaElement) => {
    const editorRoot = textarea.closest(".bg-card");
    if (!editorRoot) {
      return () => {};
    }

    const commandDeck = document.querySelector(".command-deck");

    const menu = document.createElement("div");
    menu.className = "slash-menu hidden";
    editorRoot.appendChild(menu);

    const token = document.createElement("div");
    token.className = "slash-selected-token hidden";
    editorRoot.appendChild(token);

    let isOpen = false;
    let selectedIndex = 0;
    let visibleOptions: SlashCommandOption[] = [];

    const originalSendMessage = chatPanel.agentInterface?.sendMessage.bind(chatPanel.agentInterface);

    const syncSendButtonState = () => {
      const visibleButtons = Array.from(editorRoot.querySelectorAll<HTMLButtonElement>("button")).filter(
        (button) => button.offsetParent !== null
      );
      const sendButton = visibleButtons.at(-1);

      if (!sendButton) {
        return;
      }

      const hasVisibleText = stripInvisibleMarkers(textarea.value).trim().length > 0;
      const shouldEnable = pendingCommand !== null || hasVisibleText;
      if (!chatPanel.agentInterface?.session?.state.isStreaming) {
        sendButton.disabled = !shouldEnable;
      }
    };

    const renderToken = () => {
      if (!pendingCommand) {
        token.classList.add("hidden");
        token.innerHTML = "";
        textarea.style.paddingLeft = "";
        editorRoot.classList.remove("slash-token-active");
        syncSendButtonState();
        return;
      }

      token.innerHTML = `
        <span class="slash-selected-token-label">/${escapeHtml(pendingCommand.command)}</span>
      `;
      token.classList.remove("hidden");
      editorRoot.classList.add("slash-token-active");

      requestAnimationFrame(() => {
        const tokenWidth = token.getBoundingClientRect().width;
        textarea.style.paddingLeft = `${Math.ceil(tokenWidth) + 26}px`;
        syncSendButtonState();
      });
    };

    const clearPendingCommand = (preserveText = true) => {
      pendingCommand = null;
      closeMenu();
      renderToken();

      const cleanedValue = stripInvisibleMarkers(textarea.value);
      if (!preserveText || cleanedValue === "") {
        setTextareaValue(textarea, "", 0);
        return;
      }

      const nextCaret = Math.min(textarea.selectionStart ?? cleanedValue.length, cleanedValue.length);
      setTextareaValue(textarea, cleanedValue, nextCaret);
    };

    const setPendingCommand = (option: SlashCommandOption, rest: string) => {
      pendingCommand = option;
      renderToken();
      const nextValue = rest.length > 0 ? rest : INVISIBLE_MARKER;
      const nextCaret = nextValue === INVISIBLE_MARKER ? 0 : nextValue.length;
      setTextareaValue(textarea, nextValue, nextCaret);
    };

    const closeMenu = () => {
      isOpen = false;
      selectedIndex = 0;
      visibleOptions = [];
      menu.classList.add("hidden");
      menu.innerHTML = "";
    };

    const applyOption = (option: SlashCommandOption) => {
      const rest = textarea.value.startsWith("/") ? textarea.value.replace(/^\/\S*\s*/u, "") : stripInvisibleMarkers(textarea.value);
      setPendingCommand(option, rest);
      closeMenu();
    };

    const renderMenu = () => {
      if (!isOpen || visibleOptions.length === 0) {
        closeMenu();
        return;
      }

      menu.innerHTML = visibleOptions
        .map((option, index) => {
          const kindLabel = option.kind === "builtin" ? "Builtin" : "Skill";
          const classes = index === selectedIndex ? "slash-menu-item is-selected" : "slash-menu-item";
          return `
            <button type="button" class="${classes}" data-option-index="${index}">
              <span class="slash-menu-title">/${escapeHtml(option.command)}</span>
              <span class="slash-menu-kind">${kindLabel}</span>
              <span class="slash-menu-summary">${escapeHtml(option.summary)}</span>
            </button>
          `;
        })
        .join("");

      menu.classList.remove("hidden");
    };

    const updateMenu = () => {
      const normalizedValue = stripInvisibleMarkers(textarea.value);

      if (!pendingCommand) {
        const extracted = extractLeadingSlashCommand(normalizedValue);
        if (extracted) {
          setPendingCommand(extracted.option, extracted.rest);
          closeMenu();
          return;
        }
      }

      const query = getSlashQuery(normalizedValue, textarea.selectionStart ?? normalizedValue.length);
      if (query === null) {
        closeMenu();
        syncSendButtonState();
        return;
      }

      visibleOptions = filterSlashCommands(query);
      if (visibleOptions.length === 0) {
        closeMenu();
        return;
      }

      selectedIndex = Math.min(selectedIndex, visibleOptions.length - 1);
      isOpen = true;
      renderMenu();
      syncSendButtonState();
    };

    const handleInput = () => {
      if (pendingCommand) {
        const cleanedValue = stripInvisibleMarkers(textarea.value);
        if (cleanedValue !== textarea.value) {
          const caret = cleanedValue.length;
          textarea.value = cleanedValue;
          textarea.setSelectionRange(caret, caret);
        }
      }

      updateMenu();
    };

    const handleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-option-index]");
      if (!target) {
        return;
      }

      const index = Number(target.dataset.optionIndex);
      const option = visibleOptions[index];
      if (!option) {
        return;
      }

      event.preventDefault();
      applyOption(option);
    };

    const handleCommandDeckClick = (event: Event) => {
      if (chatPanel.agentInterface?.session?.state.isStreaming) {
        return;
      }

      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-command-trigger]");
      if (!target) {
        return;
      }

      const command = target.dataset.commandTrigger;
      if (!command) {
        return;
      }

      const option = findSlashCommandOption(command);
      if (!option) {
        return;
      }

      event.preventDefault();
      setPendingCommand(option, "");
      closeMenu();
      syncSendButtonState();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const cleanedValue = stripInvisibleMarkers(textarea.value);
      const caretStart = textarea.selectionStart ?? 0;
      const caretEnd = textarea.selectionEnd ?? 0;

      if (
        pendingCommand &&
        event.key === "Backspace" &&
        cleanedValue === "" &&
        caretStart <= 1 &&
        caretEnd <= 1
      ) {
        event.preventDefault();
        event.stopPropagation();
        clearPendingCommand(false);
        return;
      }

      if (!isOpen || visibleOptions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = (selectedIndex + 1) % visibleOptions.length;
        renderMenu();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = (selectedIndex - 1 + visibleOptions.length) % visibleOptions.length;
        renderMenu();
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        applyOption(visibleOptions[selectedIndex]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      }
    };

    const handleDocumentPointerDown = (event: Event) => {
      if (!editorRoot.contains(event.target as Node)) {
        closeMenu();
      }
    };

    if (!sendMessageWrapped && originalSendMessage && chatPanel.agentInterface) {
      sendMessageWrapped = true;
      chatPanel.agentInterface.sendMessage = (async (input: string, attachments?: any[]) => {
        const cleanInput = stripInvisibleMarkers(input);
        const nextInput = pendingCommand ? `/${pendingCommand.command}${cleanInput ? ` ${cleanInput}` : ""}` : cleanInput;
        await originalSendMessage(nextInput, attachments);
        if (!chatPanel.agentInterface?.session?.state.isStreaming || pendingCommand) {
          pendingCommand = null;
          renderToken();
        }
      }) as typeof chatPanel.agentInterface.sendMessage;
    }

    textarea.addEventListener("input", handleInput);
    textarea.addEventListener("click", handleInput);
    textarea.addEventListener("focus", handleInput);
    textarea.addEventListener("keydown", handleKeyDown, true);
    menu.addEventListener("mousedown", (event) => event.preventDefault());
    menu.addEventListener("click", handleClick);
    commandDeck?.addEventListener("click", handleCommandDeckClick);
    document.addEventListener("pointerdown", handleDocumentPointerDown);

    renderToken();
    updateMenu();

    return () => {
      closeMenu();
      menu.remove();
      token.remove();
      textarea.removeEventListener("input", handleInput);
      textarea.removeEventListener("click", handleInput);
      textarea.removeEventListener("focus", handleInput);
      textarea.removeEventListener("keydown", handleKeyDown, true);
      menu.removeEventListener("click", handleClick);
      commandDeck?.removeEventListener("click", handleCommandDeckClick);
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  };

  const maybeAttach = () => {
    const textarea = chatPanel.querySelector<HTMLTextAreaElement>("message-editor textarea");
    if (!textarea || textarea === observedTextarea) {
      return;
    }

    cleanupTextarea();
    observedTextarea = textarea;
    cleanupTextarea = attachToTextarea(textarea);
  };

  const observer = new MutationObserver(() => {
    maybeAttach();
  });

  observer.observe(chatPanel, { childList: true, subtree: true });
  maybeAttach();

  return () => {
    observer.disconnect();
    cleanupTextarea();
  };
}

async function main() {
  await bootstrapStorage();
  const shellRefs = createShell(projectSkills);
  let activeSkill: SkillDefinition | null = null;

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(null),
      model: createRightCodesModel(),
      thinkingLevel: "low",
      messages: [],
      tools: []
    },
    convertToLlm: defaultConvertToLlm
  });

  const originalPrompt = agent.prompt.bind(agent) as (...args: any[]) => Promise<void>;

  const setActiveSkill = (nextSkill: SkillDefinition | null) => {
    activeSkill = nextSkill;
    agent.state.systemPrompt = buildSystemPrompt(activeSkill);
    syncActiveSkillUi(activeSkill, shellRefs);
  };

  agent.prompt = (async (...args: any[]) => {
    const [firstArg, secondArg] = args;

    if (typeof firstArg === "string") {
      const parsed = parseSlashCommand(firstArg);
      if (parsed.type === "activate") {
        setActiveSkill(parsed.skill);
        const prompt = parsed.prompt || buildActivationPrompt(parsed.skill);
        return originalPrompt(prompt, secondArg);
      }

      if (parsed.type === "clear") {
        setActiveSkill(null);
        const prompt = parsed.prompt || buildClearPrompt();
        return originalPrompt(prompt, secondArg);
      }

      return originalPrompt(firstArg, secondArg);
    }

    if (isSinglePromptMessage(firstArg)) {
      const text = getPromptMessageText(firstArg);
      if (text !== null) {
        const parsed = parseSlashCommand(text);
        if (parsed.type === "activate") {
          setActiveSkill(parsed.skill);
          return originalPrompt(
            replacePromptMessageText(firstArg, parsed.prompt || buildActivationPrompt(parsed.skill))
          );
        }

        if (parsed.type === "clear") {
          setActiveSkill(null);
          return originalPrompt(replacePromptMessageText(firstArg, parsed.prompt || buildClearPrompt()));
        }
      }
    }

    return originalPrompt(...args);
  }) as typeof agent.prompt;

  const chatPanel = new ChatPanel();
  await chatPanel.setAgent(agent, {
    onApiKeyRequired: async () => true,
    toolsFactory: () => [searchJournalsTool]
  });

  agent.subscribe((event) => {
    if (event.type === "message_end") {
      // pi-agent-core mutates state.messages in place; clone it so Lit sees a new
      // array reference and the stable message list re-renders after streaming.
      agent.state.messages = [...agent.state.messages];
      chatPanel.agentInterface?.requestUpdate();
    }

    if (event.type === "agent_end") {
      // `agent_end` fires before pi-agent-core flips state.isStreaming back to
      // false. Refresh once the run is truly idle so the send button exits the
      // "stop" state and the next prompt can be submitted.
      void agent.waitForIdle().then(() => {
        chatPanel.agentInterface?.requestUpdate();
      });
    }
  });

  if (chatPanel.agentInterface) {
    chatPanel.agentInterface.enableModelSelector = false;
    chatPanel.agentInterface.enableThinkingSelector = true;
    chatPanel.agentInterface.showThemeToggle = false;
  }

  setActiveSkill(null);
  shellRefs.chatHost.appendChild(chatPanel);
  setupSlashCommandAutocomplete(chatPanel);
}

main().catch((error: unknown) => {
  console.error(error);
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = `<pre style="padding:24px;color:#fff;">${String(error)}</pre>`;
  }
});
