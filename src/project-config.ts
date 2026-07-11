import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { providerNames } from "./providers.js";

export const DEFAULT_PROJECT_CONFIG = "okfgen.config.yml";

export const projectConfigSchema = z.object({
  provider: z.enum(providerNames).optional(),
  model: z.string().trim().min(1).optional(),
  sources: z.array(z.string().trim().min(1)).default([]),
  output: z.string().trim().min(1).default("./okfgen-bundle"),
  baseUrl: z.url().optional(),
  retries: z.number().int().min(0).max(10).optional(),
  log: z.boolean().default(true),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export async function findProjectConfig(startDirectory = process.cwd()): Promise<string | undefined> {
  let directory = path.resolve(startDirectory);
  while (true) {
    const candidate = path.join(directory, DEFAULT_PROJECT_CONFIG);
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export async function loadProjectConfig(filePath?: string): Promise<{ config: ProjectConfig; path?: string }> {
  const resolvedPath = filePath ? path.resolve(filePath) : await findProjectConfig();
  if (!resolvedPath) return { config: projectConfigSchema.parse({}) };
  let document: unknown;
  try {
    document = parse(await readFile(resolvedPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Configuration file not found: ${resolvedPath}`);
    throw error;
  }
  const result = projectConfigSchema.safeParse(document ?? {});
  if (!result.success) throw new Error(`Invalid ${path.basename(resolvedPath)}: ${result.error.issues.map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`).join("; ")}`);
  return { config: result.data, path: resolvedPath };
}

export async function createProjectConfig(filePath = DEFAULT_PROJECT_CONFIG, force = false): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  if (!force) {
    try {
      await access(resolvedPath);
      throw new Error(`${path.basename(resolvedPath)} already exists. Use --force to replace it.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const content = `# OKFgen project configuration
# Nebius is the hosted default. Set NEBIUS_API_KEY in your environment.
provider: nebius
model: zai-org/GLM-5.2

# To use a local model instead, replace the two lines above with:
# provider: ollama
# model: qwen3:8b
# Other supported providers: openrouter, openai, anthropic

# Add files, directories, or URLs that OKFgen should use as source material.
sources:
  - ./docs
output: ./okfgen-bundle
log: true
`;
  await writeFile(resolvedPath, content, "utf8");
  return resolvedPath;
}
