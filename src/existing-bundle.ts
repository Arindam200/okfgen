import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface ExistingBundle {
  root: string;
  markdownFiles: string[];
  conceptPaths: string[];
  conceptContents: Record<string, string>;
  log?: string;
}

export async function inspectExistingBundle(directory: string): Promise<ExistingBundle | undefined> {
  const root = path.resolve(directory);
  try {
    const rootIndex = await readFile(path.join(root, "index.md"), "utf8");
    const parsed = matter(rootIndex);
    if (String(parsed.data.okf_version ?? "") !== "0.1") return undefined;

    const markdownFiles = await findMarkdownFiles(root);
    const relativeFiles = markdownFiles.map((file) => toPosix(path.relative(root, file)));
    const conceptPaths = relativeFiles.filter((file) => !["index.md", "log.md"].includes(path.posix.basename(file)));
    const conceptContents = Object.fromEntries(await Promise.all(conceptPaths.map(async (file) => {
      return [file, await readFile(path.join(root, file), "utf8")] as const;
    })));
    const logPath = path.join(root, "log.md");
    const log = relativeFiles.includes("log.md") ? await readFile(logPath, "utf8") : undefined;
    return { root, markdownFiles: relativeFiles, conceptPaths, conceptContents, ...(log === undefined ? {} : { log }) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findMarkdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files.sort();
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
