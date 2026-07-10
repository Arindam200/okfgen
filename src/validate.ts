import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";

export interface ValidationIssue {
  severity: "error" | "warning";
  file: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  filesChecked: number;
  issues: ValidationIssue[];
}

export async function validateBundle(directory: string): Promise<ValidationResult> {
  const root = path.resolve(directory);
  const files = await findMarkdownFiles(root);
  const fileSet = new Set(files.map((file) => toPosix(path.relative(root, file))));
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const relative = toPosix(path.relative(root, file));
    const name = path.basename(file);
    const content = await readFile(file, "utf8");
    if (name === "index.md") validateIndex(relative, content, issues);
    else if (name === "log.md") validateLog(relative, content, issues);
    else validateConcept(relative, content, issues);
    validateLinks(relative, content, fileSet, issues);
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    filesChecked: files.length,
    issues,
  };
}

function validateConcept(file: string, content: string, issues: ValidationIssue[]): void {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    issues.push({ severity: "error", file, message: "Concept must begin with YAML frontmatter." });
    return;
  }
  try {
    const parsed = matter(content);
    if (typeof parsed.data.type !== "string" || !parsed.data.type.trim()) {
      issues.push({ severity: "error", file, message: "Frontmatter must contain a non-empty type field." });
    }
  } catch (error) {
    issues.push({ severity: "error", file, message: `Frontmatter is not parseable YAML: ${errorMessage(error)}` });
  }
}

function validateIndex(file: string, content: string, issues: ValidationIssue[]): void {
  let body = content;
  if (content.startsWith("---")) {
    if (file !== "index.md") {
      issues.push({ severity: "error", file, message: "Only the bundle-root index.md may contain frontmatter." });
    }
    try {
      const parsed = matter(content);
      body = parsed.content;
      if (file === "index.md" && parsed.data.okf_version !== undefined && String(parsed.data.okf_version) !== "0.1") {
        issues.push({ severity: "warning", file, message: `Declared OKF version ${String(parsed.data.okf_version)} is not supported by this validator.` });
      }
    } catch (error) {
      issues.push({ severity: "error", file, message: `Index frontmatter is not parseable YAML: ${errorMessage(error)}` });
      return;
    }
  }
  if (!/^#\s+\S/m.test(body)) {
    issues.push({ severity: "error", file, message: "Index must contain at least one section heading." });
  }
  if (!/^\s*[*-]\s+\[[^\]]+\]\([^)]+\)(?:\s+-\s+.+)?\s*$/m.test(body)) {
    issues.push({ severity: "warning", file, message: "Index has no linked list entries with descriptions." });
  }
}

function validateLog(file: string, content: string, issues: ValidationIssue[]): void {
  if (!/^#\s+\S/m.test(content)) {
    issues.push({ severity: "error", file, message: "Log must begin with a title heading." });
  }
  const dateHeadings = [...content.matchAll(/^##\s+(.+)\s*$/gm)].map((match) => match[1]?.trim() ?? "");
  if (dateHeadings.length === 0) {
    issues.push({ severity: "error", file, message: "Log must contain at least one date heading." });
  }
  for (const date of dateHeadings) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      issues.push({ severity: "error", file, message: `Log date heading must use YYYY-MM-DD: ${date}` });
    }
  }
}

function validateLinks(file: string, content: string, files: Set<string>, issues: ValidationIssue[]): void {
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(rawTarget)) continue;
    const cleanTarget = decodeURIComponent(rawTarget.split("#")[0] ?? "");
    if (!cleanTarget || cleanTarget.endsWith("/")) continue;
    const target = cleanTarget.startsWith("/")
      ? path.posix.normalize(cleanTarget.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), cleanTarget));
    if (target.endsWith(".md") && !files.has(target)) {
      issues.push({ severity: "warning", file, message: `Broken concept link: ${rawTarget}` });
    }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
