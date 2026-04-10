import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("openai", {
    baseUrl: "https://right.codes/codex/v1"
  });
}
