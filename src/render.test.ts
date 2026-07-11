import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderBundle } from "./render.js";
import type { BundlePlan } from "./schema.js";

describe("OKF bundle rendering", () => {
  it("updates recognized bundles, removes stale OKF files, preserves other files, and appends history", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-render-"));
    const initialPlan = plan([
      concept("keep.md", "Original content"),
      concept("retired/old.md", "Old content"),
    ]);
    await expect(renderBundle(initialPlan, root, { now: new Date("2026-07-10T10:00:00Z") }))
      .resolves.toMatchObject({ mode: "created" });
    await writeFile(path.join(root, "notes.txt"), "Do not remove me.\n", "utf8");

    const updatedPlan = plan([
      concept("keep.md", "Improved content"),
      concept("new/added.md", "New content"),
    ]);
    const result = await renderBundle(updatedPlan, root, { now: new Date("2026-07-11T10:00:00Z") });

    expect(result.mode).toBe("updated");
    await expect(readFile(path.join(root, "keep.md"), "utf8")).resolves.toContain("Improved content");
    await expect(readFile(path.join(root, "new/added.md"), "utf8")).resolves.toContain("New content");
    await expect(access(path.join(root, "retired/old.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(root, "retired/index.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, "notes.txt"), "utf8")).resolves.toBe("Do not remove me.\n");

    const log = await readFile(path.join(root, "log.md"), "utf8");
    expect(log).toContain("## 2026-07-10");
    expect(log).toContain("**Time**: 2026-07-10T10:00:00.000Z");
    expect(log).toContain("**Creation**: Generated 2 concepts");
    expect(log).toContain("## 2026-07-11");
    expect(log).toContain("**Time**: 2026-07-11T10:00:00.000Z");
    expect(log).toContain("**Update**: Changed 1, added 1, and removed 1 concepts");
    expect(log).toContain("**Changed `keep.md`**: body.");
    expect(log).toContain("**Added `new/added.md`**");
    expect(log).toContain("**Removed `retired/old.md`**");
  });

  it("still protects non-OKF non-empty directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-render-"));
    await mkdir(path.join(root, "existing"));
    await writeFile(path.join(root, "existing", "notes.txt"), "personal files", "utf8");

    await expect(renderBundle(plan([concept("new.md", "New content")]), root))
      .rejects.toThrow("is not an OKF v0.1 bundle");
  });
});

function plan(concepts: BundlePlan["concepts"]): BundlePlan {
  return { title: "Demo Bundle", description: "A demo bundle.", concepts };
}

function concept(conceptPath: string, body: string): BundlePlan["concepts"][number] {
  return {
    path: conceptPath,
    type: "Guide",
    title: path.posix.basename(conceptPath, ".md"),
    description: `Documentation for ${conceptPath}.`,
    tags: [],
    body,
  };
}
