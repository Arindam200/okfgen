import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateBundle } from "./validate.js";

describe("bundle validation", () => {
  it("requires a versioned root index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-validate-"));
    await writeFile(path.join(root, "guide.md"), "---\ntype: Guide\n---\n\nBody.\n", "utf8");
    const result = await validateBundle(root);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ file: "index.md", message: expect.stringContaining("must contain") }));
  });

  it("reports links to missing heading anchors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-validate-"));
    await writeFile(path.join(root, "index.md"), "---\nokf_version: \"0.1\"\n---\n\n# Demo\n\n* [Guide](guide.md#missing) - Guide.\n", "utf8");
    await writeFile(path.join(root, "guide.md"), "---\ntype: Guide\n---\n\n# Present\n", "utf8");
    const result = await validateBundle(root);
    expect(result.issues).toContainEqual(expect.objectContaining({ message: "Broken heading anchor: guide.md#missing" }));
  });
});
