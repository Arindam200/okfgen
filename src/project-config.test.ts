import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectConfig, findProjectConfig, loadProjectConfig } from "./project-config.js";

describe("project configuration", () => {
  it("creates and loads a starter configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-project-"));
    const file = path.join(root, "okfgen.config.yml");
    await createProjectConfig(file);
    const content = await readFile(file, "utf8");
    expect(content).toContain("provider: nebius");
    expect(content).toContain("Set NEBIUS_API_KEY");
    expect(content).toContain("# provider: ollama");
    const loaded = await loadProjectConfig(file);
    expect(loaded.config).toMatchObject({
      provider: "nebius",
      model: "zai-org/GLM-5.2",
      sources: ["./docs"],
      log: true,
    });
  });

  it("discovers configuration in a parent directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-project-"));
    const nested = path.join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, "okfgen.config.yml"), "output: ./knowledge\n", "utf8");
    await expect(findProjectConfig(nested)).resolves.toBe(path.join(root, "okfgen.config.yml"));
  });

  it("rejects invalid providers with a useful error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-project-"));
    const file = path.join(root, "okfgen.config.yml");
    await writeFile(file, "provider: imaginary\n", "utf8");
    await expect(loadProjectConfig(file)).rejects.toThrow("provider");
  });

  it("does not overwrite an existing configuration without force", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-project-"));
    const file = path.join(root, "okfgen.config.yml");
    await writeFile(file, "custom: true\n", "utf8");
    await expect(createProjectConfig(file)).rejects.toThrow("already exists");
    expect(await readFile(file, "utf8")).toBe("custom: true\n");
  });
});
