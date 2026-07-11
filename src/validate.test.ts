import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateBundle } from "./validate.js";

describe("bundle validation", () => {
  it("accepts a bundle without the optional root index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-validate-"));
    await writeFile(path.join(root, "guide.md"), "---\ntype: Guide\n---\n\nBody.\n", "utf8");
    const result = await validateBundle(root);
    expect(result.valid).toBe(true);
  });

  it("reports links to missing heading anchors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-validate-"));
    await writeFile(path.join(root, "index.md"), "---\nokf_version: \"0.1\"\n---\n\n# Demo\n\n* [Guide](guide.md#missing) - Guide.\n", "utf8");
    await writeFile(path.join(root, "guide.md"), "---\ntype: Guide\n---\n\n# Present\n", "utf8");
    const result = await validateBundle(root);
    expect(result.issues).toContainEqual(expect.objectContaining({ message: "Broken heading anchor: guide.md#missing" }));
  });

  it("requires log date groups to be newest first", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-validate-"));
    await writeFile(path.join(root, "log.md"), "# Directory Update Log\n\n## 2026-07-10\n* **Creation**: Created.\n\n## 2026-07-11\n* **Update**: Updated.\n", "utf8");
    const result = await validateBundle(root);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ message: "Log date groups must be ordered newest first." }));
  });
});
