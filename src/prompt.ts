import type { BaseMessageLike } from "@langchain/core/messages";

export function buildGenerationMessages(
  request: string,
  sourceContext: string,
  existingBundleContext = "",
): BaseMessageLike[] {
  return [
    {
      role: "system",
      content: `You are an information architect producing an Open Knowledge Format (OKF) v0.1 bundle plan.

Return ONLY valid JSON. Do not wrap it in markdown fences and do not add commentary.

The JSON shape is:
{
  "title": "Bundle title",
  "description": "One sentence bundle summary",
  "concepts": [
    {
      "path": "group/kebab-case-name.md",
      "type": "A descriptive concept type",
      "title": "Human-readable title",
      "description": "One-sentence summary",
      "resource": "optional canonical URI",
      "tags": ["short-tag"],
      "body": "Markdown body without YAML frontmatter",
      "metadata": { "optional_extension_key": "optional JSON-compatible value" }
    }
  ]
}

Requirements:
- Create between 1 and 100 focused concepts. Prefer a useful hierarchy over a single oversized document.
- Every path is relative, ends in .md, and never uses the reserved filenames index.md or log.md.
- Use structural Markdown in body: headings, lists, tables, and fenced examples when useful.
- Use # Schema, # Examples, and # Citations when applicable.
- Cross-link related concepts with bundle-absolute links such as /group/concept.md.
- Do not invent citations or factual claims. Preserve uncertainty and only cite sources present in the input.
- Do not put YAML frontmatter in body; it is rendered deterministically later.
- When an existing OKF bundle is supplied, return the complete improved replacement plan, not a patch or partial list.
- Preserve accurate existing knowledge, paths, metadata, and cross-links unless the request or newer source material justifies changing them.
- Consolidate duplication, correct stale material, and remove concepts only when they are obsolete or no longer useful.`,
    },
    {
      role: "user",
      content: `Generation request:\n${request}\n\nSource material:\n${sourceContext || "No additional source material was supplied."}\n\nExisting OKF bundle to improve:\n${existingBundleContext || "No existing OKF bundle was found. Create a new bundle."}`,
    },
  ];
}
