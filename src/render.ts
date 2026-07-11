import { mkdir, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import matter from "gray-matter";
import { stringify } from "yaml";
import { inspectExistingBundle, type ExistingBundle } from "./existing-bundle.js";
import type { BundlePlan, Concept } from "./schema.js";

export interface RenderOptions {
  force?: boolean;
  includeLog?: boolean;
  now?: Date;
}

export interface RenderResult {
  mode: "created" | "updated";
  files: string[];
}

export async function renderBundle(
  plan: BundlePlan,
  outputDirectory: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const root = path.resolve(outputDirectory);
  const existingBundle = await inspectExistingBundle(root);
  await assertWritableDestination(root, options.force ?? false, Boolean(existingBundle));
  await mkdir(root, { recursive: true });

  const now = options.now ?? new Date();
  const files: string[] = [];

  for (const concept of plan.concepts) {
    const destination = safeDestination(root, concept.path);
    const existingContent = existingBundle?.conceptContents[concept.path];
    const unchanged = existingContent !== undefined && changedConceptFields(existingContent, concept).length === 0;
    if (!unchanged) {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, renderConcept(concept, now), "utf8");
    }
    files.push(concept.path);
  }

  for (const [relativePath, content] of buildIndexes(plan)) {
    const destination = safeDestination(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
    files.push(relativePath);
  }

  if (existingBundle) {
    await removeStaleGeneratedFiles(root, existingBundle, new Set(files));
  }

  if (options.includeLog !== false) {
    const log = renderLog(plan, now, existingBundle);
    await writeFile(path.join(root, "log.md"), log, "utf8");
    files.push("log.md");
  }

  return { mode: existingBundle ? "updated" : "created", files: files.sort() };
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

async function assertWritableDestination(root: string, force: boolean, updating: boolean): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (entries.length > 0 && !force && !updating) {
    throw new Error(`Output directory is not empty and is not an OKF v0.1 bundle: ${root}. Use --force to add or replace generated files.`);
  }
}

function renderLog(plan: BundlePlan, now: Date, existingBundle: ExistingBundle | undefined): string {
  const date = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();
  if (!existingBundle) {
    const created = plan.concepts.map((concept) => `* **Creation**: At ${timestamp}, added ${conceptLink(concept.path)}.`).join("\n");
    return `# Directory Update Log\n\n## ${date}\n${created}\n`;
  }

  const previousPaths = new Set(existingBundle.conceptPaths);
  const nextPaths = new Set(plan.concepts.map((concept) => concept.path));
  const changed = plan.concepts.flatMap((concept) => {
    if (!previousPaths.has(concept.path)) return [];
    const fields = changedConceptFields(existingBundle.conceptContents[concept.path], concept);
    return fields.length > 0 ? [{ path: concept.path, fields }] : [];
  });
  const added = [...nextPaths].filter((conceptPath) => !previousPaths.has(conceptPath));
  const removed = [...previousPaths].filter((conceptPath) => !nextPaths.has(conceptPath));
  const entries = [
    ...changed.map((change) => `* **Update**: At ${timestamp}, changed ${conceptLink(change.path)} (${change.fields.join(", ")}).`),
    ...added.map((conceptPath) => `* **Creation**: At ${timestamp}, added ${conceptLink(conceptPath)}.`),
    ...removed.map((conceptPath) => `* **Deprecation**: At ${timestamp}, removed ${conceptLink(conceptPath)}.`),
  ];
  if (entries.length === 0) entries.push(`* **Update**: At ${timestamp}, no concept content changed.`);
  return prependLogEntries(existingBundle.log, date, entries);
}

function prependLogEntries(existingLog: string | undefined, date: string, entries: string[]): string {
  const history = existingLog?.trim() || "# Directory Update Log";
  const heading = `## ${date}`;
  const rootHeading = "# Directory Update Log";
  const body = history.startsWith(rootHeading) ? history.slice(rootHeading.length).trim() : history;
  if (body.startsWith(heading)) {
    return `${rootHeading}\n\n${heading}\n${entries.join("\n")}\n${body.slice(heading.length).trimStart()}\n`;
  }
  return `${rootHeading}\n\n${heading}\n${entries.join("\n")}\n\n${body}\n`;
}

function conceptLink(conceptPath: string): string {
  return `[${conceptPath}](/${conceptPath.split("/").map(encodeURIComponent).join("/")})`;
}

function changedConceptFields(existingContent: string | undefined, concept: Concept): string[] {
  if (!existingContent) return ["content"];
  const existing = matter(existingContent);
  const fields: string[] = [];
  if (existing.data.type !== concept.type) fields.push("type");
  if (existing.data.title !== concept.title) fields.push("title");
  if (existing.data.description !== concept.description) fields.push("description");
  if ((existing.data.resource ?? undefined) !== (concept.resource ?? undefined)) fields.push("resource");
  if (!isDeepStrictEqual(existing.data.tags ?? [], concept.tags)) fields.push("tags");
  if (existing.content.trim() !== concept.body.trim()) fields.push("body");
  const existingMetadata = removeReservedMetadata(existing.data);
  delete existingMetadata.timestamp;
  if (!isDeepStrictEqual(existingMetadata, concept.metadata ?? {})) fields.push("metadata");
  return fields;
}

async function removeStaleGeneratedFiles(
  root: string,
  existingBundle: ExistingBundle,
  nextGeneratedFiles: Set<string>,
): Promise<void> {
  const staleFiles = existingBundle.markdownFiles.filter((relativePath) => {
    return path.posix.basename(relativePath) !== "log.md" && !nextGeneratedFiles.has(relativePath);
  });

  for (const relativePath of staleFiles) {
    await unlink(safeDestination(root, relativePath));
  }

  const directories = [...new Set(staleFiles.map((relativePath) => path.posix.dirname(relativePath)))]
    .filter((directory) => directory !== ".")
    .sort((a, b) => b.split("/").length - a.split("/").length);
  for (const directory of directories) {
    try {
      await rmdir(safeDestination(root, directory));
    } catch (error) {
      if (!(["ENOENT", "ENOTEMPTY"] as Array<string | undefined>).includes((error as NodeJS.ErrnoException).code)) throw error;
    }
  }
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
