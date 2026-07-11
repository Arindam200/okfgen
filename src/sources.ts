import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { VERSION } from "./version.js";

const supportedExtensions = new Set([
  ".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv",
  ".ts", ".tsx", ".js", ".jsx", ".py", ".sql", ".graphql", ".gql",
]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "coverage"]);

export interface SourceOptions {
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  filter?: (absolutePath: string) => boolean;
}

export async function loadSources(inputs: string[], options: SourceOptions = {}): Promise<string> {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const chunks: string[] = [];
  let usedBytes = 0;

  const append = (label: string, content: string): void => {
    const bytes = Buffer.byteLength(content);
    if (usedBytes + bytes > maxBytes) {
      throw new Error(`Source material exceeds the ${maxBytes.toLocaleString()} byte limit.`);
    }
    chunks.push(`\n===== SOURCE: ${label} =====\n${content.trim()}\n`);
    usedBytes += bytes;
  };

  for (const input of inputs) {
    if (/^https?:\/\//i.test(input)) {
      const content = await fetchSource(input, options.fetchImpl ?? fetch, maxBytes - usedBytes);
      append(input, content);
      continue;
    }

    const absolute = path.resolve(input);
    const sourceStat = await stat(absolute);
    if (sourceStat.isFile()) {
      if (options.filter?.(absolute) !== false) append(input, await readFile(absolute, "utf8"));
    } else if (sourceStat.isDirectory()) {
      for (const file of await findSourceFiles(absolute, options.filter)) {
        append(path.relative(process.cwd(), file), await readFile(file, "utf8"));
      }
    } else {
      throw new Error(`Unsupported source: ${input}`);
    }
  }
  return chunks.join("").trim();
}

async function fetchSource(url: string, fetchImpl: typeof fetch, remainingBytes: number): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { "user-agent": `okfgen/${VERSION}` },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > remainingBytes) throw new Error(`Source ${url} exceeds the remaining input limit.`);
  const content = await response.text();
  if (Buffer.byteLength(content) > remainingBytes) {
    throw new Error(`Source ${url} exceeds the remaining input limit.`);
  }
  return content;
}

async function findSourceFiles(directory: string, filter?: SourceOptions["filter"]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findSourceFiles(absolute, filter));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    if (filter?.(absolute) === false) continue;
    files.push(absolute);
  }
  return files.sort();
}
