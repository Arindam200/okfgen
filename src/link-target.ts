import path from "node:path";

export type MarkdownLinkTarget =
  | { kind: "ignored" }
  | { kind: "invalid" }
  | { kind: "resolved"; path: string; fragment?: string; hasMarkdownPath: boolean };

export function resolveMarkdownLinkTarget(from: string, rawTarget: string): MarkdownLinkTarget {
  if (/^(?:[a-z][a-z\d+.-]*:)/i.test(rawTarget)) return { kind: "ignored" };

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawTarget);
  } catch {
    return { kind: "invalid" };
  }

  const [rawPath = "", fragment] = decoded.split("#", 2);
  if (rawPath.endsWith("/") || (rawPath && !rawPath.endsWith(".md"))) return { kind: "ignored" };

  const target = !rawPath
    ? from
    : rawPath.startsWith("/")
      ? path.posix.normalize(rawPath.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(from), rawPath));

  return { kind: "resolved", path: target, fragment, hasMarkdownPath: rawPath.endsWith(".md") };
}
