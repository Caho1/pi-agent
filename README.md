# pi Agent Demo

This is a minimal `pi SDK` demo that shows three things together:

- project-local skill discovery from `.pi/skills/`
- a custom tool registered through the SDK
- a small interactive CLI chat loop
- project-level role/context files via `SOUL.md` and `AGENT.md`
- a `pi-web-ui` browser frontend backed by the same project context

The demo now supports project-local skills as slash commands in the web UI. By default, no skill is active; type `/<skill-folder-name> your request` to activate one on demand for the current session.

## 1. Install

```bash
cd /Users/jiahao/Desktop/PythonProject/pi-agent-demo
npm install
```

## 2. Configure a model API key

This demo is preconfigured to route the built-in `openai` provider through `https://right.codes/codex/v1` using the project extension in `.pi/extensions/right-codes-provider.ts`.

The easiest path is a local `.env` file:

```bash
cp .env.example .env
```

Then fill in your key:

```bash
OPENAI_API_KEY=your_right_codes_key_here
```

You can also use a shell environment variable or `~/.pi/agent/auth.json`, but the local `.env` is the cleanest option for this demo.

## 3. Run

Interactive chat:

```bash
npm run chat
```

One-shot demo prompt:

```bash
npm run demo
```

Browser frontend:

```bash
npm run web:dev
```

Then open `http://127.0.0.1:5173` or the URL shown by Vite.

The web frontend uses a local Vite proxy so your `OPENAI_API_KEY` stays server-side in the Node dev process instead of being embedded into the browser bundle.

Slash commands in the web UI:

```text
/ 先弹出所有可用命令，再继续输入做过滤
/demo-journal-agent 请帮我推荐适合投稿的期刊
/maoxuan-skill 用毛泽东的方法分析这个竞争格局
/clear 退出当前 skill，回到普通对话
```

When you add a new skill under `.pi/skills/<skill-name>/SKILL.md`, the web frontend will pick it up automatically on restart and expose it as `/<skill-name>`.

Type `exit` to quit the interactive session.

## Example prompts

```text
/demo-journal-agent 请根据这段摘要推荐适合投稿的期刊：我们提出了一种面向多模态检索的高效训练框架，重点关注召回率和推理延迟。
```

```text
/maoxuan-skill 用毛泽东的方法分析：为什么一个新 AI 产品在红海里仍然可能找到突破口？
```

## Files

- `src/index.ts`: session bootstrap, CLI, custom tool, skill-aware prompt
- `src/catalog.ts`: sample journal catalog and search logic
- `.pi/skills/*/SKILL.md`: project-local skills, exposed as slash commands in the web UI
- `SOUL.md`: role, tone, identity, and decision priorities
- `AGENT.md`: larger operating guidelines and output policy
- `web/main.ts`: `pi-web-ui` frontend entry, system prompt assembly, and browser agent wiring
- `web/app.css`: frontend layout and visual styling
- `vite.config.ts`: local proxy to `right.codes`
