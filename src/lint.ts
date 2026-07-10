import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { validateBundle, type ValidationIssue } from "./validate.js";

export interface LintIssue extends ValidationIssue {
  rule: string;
}

export interface LintResult {
  valid: boolean;
  filesChecked: number;
  issues: LintIssue[];
}

interface ConceptDocument {
  file: string;
  title?: string;
  body: string;
  data: Record<string, unknown>;
  links: string[];
}

export async function lintBundle(directory: string, options: { strict?: boolean } = {}): Promise<LintResult> {
  const root = path.resolve(directory);
  const validation = await validateBundle(root);
  const issues: LintIssue[] = validation.issues.map((issue) => ({ ...issue, rule: "okf-conformance" }));
  const files = await findConceptFiles(root);
  const documents = await Promise.all(files.map((file) => readConcept(root, file)));
  const conceptSet = new Set(documents.map((document) => document.file));

  reportDuplicateTitles(documents, issues);
  reportOrphans(documents, conceptSet, issues);
  for (const document of documents) {
    reportThinContent(document, issues);
    reportHeadingHierarchy(document, issues);
    reportProvenance(document, issues);
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error" || (options.strict && issue.severity === "warning")),
    filesChecked: validation.filesChecked,
    issues,
  };
}

function reportDuplicateTitles(documents: ConceptDocument[], issues: LintIssue[]): void {
  const titles = new Map<string, string[]>();
  for (const document of documents) {
    if (!document.title) continue;
    const normalized = document.title.trim().toLocaleLowerCase();
    titles.set(normalized, [...(titles.get(normalized) ?? []), document.file]);
  }
  for (const duplicates of titles.values()) {
    if (duplicates.length < 2) continue;
    for (const file of duplicates) issues.push({ severity: "warning", file, rule: "unique-title", message: `Duplicate concept title also used by: ${duplicates.filter((item) => item !== file).join(", ")}` });
  }
}

function reportOrphans(documents: ConceptDocument[], concepts: Set<string>, issues: LintIssue[]): void {
  if (documents.length < 2) return;
  const connected = new Set<string>();
  for (const document of documents) {
    for (const target of document.links) {
      const resolved = resolveLink(document.file, target);
      if (resolved && concepts.has(resolved)) {
        connected.add(document.file);
        connected.add(resolved);
      }
    }
  }
  for (const document of documents) {
    if (!connected.has(document.file)) issues.push({ severity: "warning", file: document.file, rule: "no-orphan-concepts", message: "Concept has no links to or from another concept." });
  }
}

function reportThinContent(document: ConceptDocument, issues: LintIssue[]): void {
  const words = document.body.replace(/[`*_#>\[\](){}|-]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  if (words < 40) issues.push({ severity: "warning", file: document.file, rule: "substantive-content", message: `Concept body is unusually thin (${words} words; recommended minimum is 40).` });
}

function reportHeadingHierarchy(document: ConceptDocument, issues: LintIssue[]): void {
  const levels = [...document.body.matchAll(/^(#{1,6})\s+\S/gm)].map((match) => match[1]!.length);
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index]! > levels[index - 1]! + 1) {
      issues.push({ severity: "warning", file: document.file, rule: "heading-order", message: `Heading level jumps from H${levels[index - 1]} to H${levels[index]}.` });
      return;
    }
  }
}

function reportProvenance(document: ConceptDocument, issues: LintIssue[]): void {
  const sources = document.data.sources;
  if (!document.data.resource && (!Array.isArray(sources) || sources.length === 0)) {
    issues.push({ severity: "warning", file: document.file, rule: "source-provenance", message: "Concept does not declare resource or sources provenance." });
  }
}

async function readConcept(root: string, absolute: string): Promise<ConceptDocument> {
  const file = toPosix(path.relative(root, absolute));
  const content = await readFile(absolute, "utf8");
  try {
    const parsed = matter(content);
    return {
      file,
      title: typeof parsed.data.title === "string" ? parsed.data.title : undefined,
      body: parsed.content,
      data: parsed.data,
      links: [...parsed.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]!.trim()),
    };
  } catch {
    return { file, body: content, data: {}, links: [] };
  }
}

function resolveLink(from: string, rawTarget: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(rawTarget)) return undefined;
  const target = decodeURIComponent(rawTarget.split("#")[0] ?? "");
  if (!target.endsWith(".md")) return undefined;
  return target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
}

async function findConceptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findConceptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md") && !["index.md", "log.md"].includes(entry.name)) files.push(absolute);
  }
  return files.sort();
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
