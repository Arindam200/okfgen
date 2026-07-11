import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateBundle } from "./generate.js";
import { renderBundle } from "./render.js";
import type { BundlePlan } from "./schema.js";

describe("bundle generation", () => {
  it("provides an existing bundle to the model and returns update mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-generate-"));
    const existingPlan = bundlePlan("Existing guidance");
    await renderBundle(existingPlan, root, { now: new Date("2026-07-10T10:00:00Z") });

    const updatedPlan = bundlePlan("Improved guidance");
    const invoke = vi.fn(async (_messages: unknown) => ({ content: JSON.stringify(updatedPlan) }));
    const progress = vi.fn();
    const result = await generateBundle({
      provider: "ollama",
      model: "test-model",
      modelInstance: { invoke } as unknown as BaseChatModel,
      request: "Improve what is already here",
      outputDirectory: root,
      onProgress: progress,
    });

    expect(result.mode).toBe("updated");
    expect(progress.mock.calls.map(([event]) => event.stage)).toEqual(["inspect", "sources", "model", "write", "validate"]);
    const messages = invoke.mock.calls[0]?.[0] as Array<{ content: string }> | undefined;
    expect(messages?.[1]?.content).toContain("Existing guidance");
    expect(messages?.[1]?.content).not.toContain("Directory Update Log");
    await expect(readFile(path.join(root, "guide.md"), "utf8")).resolves.toContain("Improved guidance");
    await expect(readFile(path.join(root, "log.md"), "utf8")).resolves.toContain("**Update**: Improved 1 existing concept");
  });

  it("reports and repairs an invalid first model response", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-generate-"));
    const repairedPlan = bundlePlan("Repaired guidance");
    const invoke = vi.fn()
      .mockResolvedValueOnce({ content: "not json" })
      .mockResolvedValueOnce({ content: JSON.stringify(repairedPlan) });
    const progress = vi.fn();
    const result = await generateBundle({
      provider: "ollama",
      model: "test-model",
      modelInstance: { invoke } as unknown as BaseChatModel,
      request: "Create guidance",
      outputDirectory: root,
      onProgress: progress,
    });

    expect(result.mode).toBe("created");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([event]) => event.stage)).toContain("repair");
  });
});

function bundlePlan(body: string): BundlePlan {
  return {
    title: "Demo Bundle",
    description: "A demo bundle.",
    concepts: [{
      path: "guide.md",
      type: "Guide",
      title: "Guide",
      description: "Guidance.",
      tags: [],
      body,
    }],
  };
}
