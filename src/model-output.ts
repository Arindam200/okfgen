import { bundlePlanSchema, type BundlePlan } from "./schema.js";

export function parseBundlePlan(content: unknown): BundlePlan {
  const text = extractText(content).trim();
  const candidates = [text, stripFence(text), extractJsonObject(text)];
  let lastError: unknown;

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return bundlePlanSchema.parse(JSON.parse(candidate));
    } catch (error) {
      lastError = error;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "No JSON object found";
  throw new Error(`The model did not return a valid OKF bundle plan: ${reason}`);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  throw new Error("The model returned an unsupported content type");
}

function stripFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractJsonObject(value: string): string {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return start >= 0 && end > start ? value.slice(start, end + 1) : "";
}
