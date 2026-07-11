import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintBundle } from "./lint.js";

describe("bundle linting", () => {
  it("reports duplicate titles, orphans, thin content, and heading jumps", async () => {
    const root = await fixture();
    const result = await lintBundle(root);
    const rules = result.issues.map((issue) => issue.rule);
    expect(rules).toContain("unique-title");
    expect(rules).toContain("no-orphan-concepts");
    expect(rules).toContain("substantive-content");
    expect(rules).toContain("heading-order");
    expect(result.valid).toBe(true);
  });

  it("promotes warnings to a failing result in strict mode", async () => {
    const root = await fixture();
    await expect(lintBundle(root, { strict: true })).resolves.toMatchObject({ valid: false });
  });

  it("reports malformed link encoding without crashing", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "guides", "one.md"), "---\ntype: Guide\ntitle: One\n---\n\n[Malformed](%ZZ)\n", "utf8");
    const result = await lintBundle(root);
    expect(result.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining("not valid URL encoding") }));
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-lint-"));
  await mkdir(path.join(root, "guides"));
  await writeFile(path.join(root, "index.md"), "---\nokf_version: \"0.1\"\n---\n\n# Demo\n\n* [One](guides/one.md) - One.\n", "utf8");
  await writeFile(path.join(root, "guides", "one.md"), "---\ntype: Guide\ntitle: Same\n---\n\n# Start\n\n### Jumped\n\nShort body.\n", "utf8");
  await writeFile(path.join(root, "guides", "two.md"), "---\ntype: Guide\ntitle: Same\n---\n\nAlso short.\n", "utf8");
  return root;
}
