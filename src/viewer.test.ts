import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildViewerData } from "./viewer.js";

describe("OKF viewer", () => {
  it("builds graph edges and sanitizes rendered documents", async () => {
    const root = await fixture();
    const data = await buildViewerData(root);

    expect(data.title).toBe("Demo Bundle");
    expect(data.concepts).toHaveLength(2);
    expect(data.edges).toEqual([{ source: "guides/start.md", target: "reference/api.md" }]);
    expect(data.concepts.find((concept) => concept.id === "guides/start.md")?.html).not.toContain("script");
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "okf-viewer-"));
  await mkdir(path.join(root, "guides"), { recursive: true });
  await mkdir(path.join(root, "reference"), { recursive: true });
  await writeFile(path.join(root, "index.md"), "---\nokf_version: \"0.1\"\n---\n\n# Demo Bundle\n", "utf8");
  await writeFile(path.join(root, "guides", "start.md"), "---\ntype: Guide\ntitle: Start Here\ndescription: Entry point.\ntags: [quickstart]\n---\n\nSee the [API](/reference/api.md).\n<script>alert('x')</script>\n", "utf8");
  await writeFile(path.join(root, "reference", "api.md"), "---\ntype: API\ntitle: API Reference\ndescription: Endpoints.\n---\n\n# Endpoints\n", "utf8");
  return root;
}
