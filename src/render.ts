import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type { BundlePlan, Concept } from "./schema.js";

export interface RenderOptions {
  force?: boolean;
  includeLog?: boolean;
  now?: Date;
}

export interface RenderResult {
  files: string[];
}

export async function renderBundle(
  plan: BundlePlan,
  outputDirectory: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const root = path.resolve(outputDirectory);
  await assertWritableDestination(root, options.force ?? false);
  await mkdir(root, { recursive: true });

  const now = options.now ?? new Date();
  const files: string[] = [];

  for (const concept of plan.concepts) {
    const destination = safeDestination(root, concept.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, renderConcept(concept, now), "utf8");
    files.push(concept.path);
  }

  for (const [relativePath, content] of buildIndexes(plan)) {
    const destination = safeDestination(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
    files.push(relativePath);
  }

  if (options.includeLog !== false) {
    const log = `# Directory Update Log\n\n## ${now.toISOString().slice(0, 10)}\n\n* **Creation**: Generated ${plan.concepts.length} concept${plan.concepts.length === 1 ? "" : "s"} with OKF CLI.\n`;
    await writeFile(path.join(root, "log.md"), log, "utf8");
    files.push("log.md");
  }

  return { files: files.sort() };
}

export function renderConcept(concept: Concept, now = new Date()): string {
  const metadata = removeReservedMetadata(concept.metadata ?? {});
  const frontmatter = {
    ...metadata,
    type: concept.type,
    title: concept.title,
    description: concept.description,
    ...(concept.resource ? { resource: concept.resource } : {}),
    ...(concept.tags.length > 0 ? { tags: concept.tags } : {}),
    timestamp: now.toISOString(),
  };

  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${concept.body.trim()}\n`;
}

function buildIndexes(plan: BundlePlan): Map<string, string> {
  const conceptsByDirectory = new Map<string, Concept[]>();
  const childDirectories = new Map<string, Set<string>>();
  conceptsByDirectory.set("", []);

  for (const concept of plan.concepts) {
    const directory = path.posix.dirname(concept.path) === "." ? "" : path.posix.dirname(concept.path);
    const parts = directory ? directory.split("/") : [];
    conceptsByDirectory.set(directory, [...(conceptsByDirectory.get(directory) ?? []), concept]);

    let parent = "";
    for (const part of parts) {
      const current = parent ? `${parent}/${part}` : part;
      if (!childDirectories.has(parent)) childDirectories.set(parent, new Set());
      childDirectories.get(parent)?.add(current);
      if (!conceptsByDirectory.has(current)) conceptsByDirectory.set(current, []);
      parent = current;
    }
  }

  const indexes = new Map<string, string>();
  for (const directory of conceptsByDirectory.keys()) {
    const sections: string[] = [];
    const children = [...(childDirectories.get(directory) ?? [])].sort();
    if (children.length > 0) {
      sections.push("# Groups\n\n" + children.map((child) => {
        const name = path.posix.basename(child);
        return `* [${humanize(name)}](${name}/) - Concepts grouped under ${humanize(name)}.`;
      }).join("\n"));
    }

    const concepts = (conceptsByDirectory.get(directory) ?? []).sort((a, b) => a.path.localeCompare(b.path));
    if (concepts.length > 0) {
      sections.push("# Concepts\n\n" + concepts.map((concept) => {
        return `* [${concept.title}](${path.posix.basename(concept.path)}) - ${concept.description}`;
      }).join("\n"));
    }

    const body = sections.join("\n\n") + "\n";
    if (directory === "") {
      const rootFrontmatter = stringify({ okf_version: "0.1" }).trimEnd();
      indexes.set("index.md", `---\n${rootFrontmatter}\n---\n\n# ${plan.title}\n\n${plan.description}\n\n${body}`);
    } else {
      indexes.set(`${directory}/index.md`, body);
    }
  }
  return indexes;
}

function removeReservedMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const result = { ...metadata };
  for (const key of ["type", "title", "description", "resource", "tags", "timestamp"]) delete result[key];
  return result;
}

function safeDestination(root: string, relativePath: string): string {
  const destination = path.resolve(root, relativePath);
  if (destination !== root && !destination.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside the bundle: ${relativePath}`);
  }
  return destination;
}

async function assertWritableDestination(root: string, force: boolean): Promise<void> {
  try {
    const entries = await readdir(root);
    if (entries.length > 0 && !force) {
      throw new Error(`Output directory is not empty: ${root}. Use --force to add or replace generated files.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
