import test from "node:test";
import assert from "node:assert/strict";

import { parseCliArgs } from "../src/cli-options.js";
import { createProjectServices, getProjectModel } from "../src/runtime.js";

test("parseCliArgs returns prompt from positional arguments", () => {
  assert.deepEqual(parseCliArgs(["hello", "world"]), {
    showHelp: false,
    prompt: "hello world"
  });
});

test("parseCliArgs treats help flags as help and ignores positional prompt", () => {
  assert.deepEqual(parseCliArgs(["--help", "hello"]), {
    showHelp: true,
    prompt: ""
  });

  assert.deepEqual(parseCliArgs(["-h"]), {
    showHelp: true,
    prompt: ""
  });
});

test("getProjectModel resolves the official gpt-5.4 model", () => {
  const model = getProjectModel({
    find(provider: string, modelId: string) {
      if (provider === "openai" && modelId === "gpt-5.4") {
        return {
          id: "gpt-5.4",
          provider: "openai",
          baseUrl: "https://right.codes/codex/v1"
        };
      }

      return undefined;
    }
  });

  assert.equal(model.provider, "openai");
  assert.equal(model.id, "gpt-5.4");
  assert.equal(model.baseUrl, "https://right.codes/codex/v1");
});

test("createProjectServices applies the right.codes provider override to gpt-5.4", async () => {
  const services = await createProjectServices();
  const model = services.modelRegistry.find("openai", "gpt-5.4");

  assert.ok(model);
  assert.equal(model.baseUrl, "https://right.codes/codex/v1");
});
