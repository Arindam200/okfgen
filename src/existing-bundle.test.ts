import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectExistingBundle } from "./existing-bundle.js";

describe("existing bundle inspection", () => {
  it("returns undefined when the root index does not exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-existing-"));
    await expect(inspectExistingBundle(root)).resolves.toBeUndefined();
  });

  it("preserves parse failures from an invalid root index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-existing-"));
    await writeFile(path.join(root, "index.md"), "---\nokf_version: [invalid\n---\n", "utf8");
    await expect(inspectExistingBundle(root)).rejects.toThrow();
  });
});
