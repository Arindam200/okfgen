import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessageLike } from "@langchain/core/messages";
import { createChatModel, type ModelOptions } from "./providers.js";
import { buildGenerationMessages } from "./prompt.js";
import { parseBundlePlan } from "./model-output.js";
import { renderBundle } from "./render.js";
import { loadSources } from "./sources.js";
import { validateBundle, type ValidationResult } from "./validate.js";
import type { BundlePlan } from "./schema.js";

export interface GenerateOptions extends ModelOptions {
  request: string;
  outputDirectory: string;
  sources?: string[];
  force?: boolean;
  includeLog?: boolean;
  modelInstance?: BaseChatModel;
}

export interface GenerateResult {
  plan: BundlePlan;
  files: string[];
  validation: ValidationResult;
}

export async function generateBundle(options: GenerateOptions): Promise<GenerateResult> {
  const context = await loadSources(options.sources ?? []);
  const messages = buildGenerationMessages(options.request, context);
  const model = options.modelInstance ?? createChatModel(options);
  const plan = await invokeForPlan(model, messages);
  const rendered = await renderBundle(plan, options.outputDirectory, {
    force: options.force,
    includeLog: options.includeLog,
  });
  const validation = await validateBundle(options.outputDirectory);
  if (!validation.valid) {
    const errors = validation.issues.filter((issue) => issue.severity === "error");
    throw new Error(`Generated bundle failed validation: ${errors.map((issue) => `${issue.file}: ${issue.message}`).join("; ")}`);
  }
  return { plan, files: rendered.files, validation };
}

async function invokeForPlan(model: BaseChatModel, messages: BaseMessageLike[]): Promise<BundlePlan> {
  const response = await model.invoke(messages);
  try {
    return parseBundlePlan(response.content);
  } catch (firstError) {
    const repairMessages: BaseMessageLike[] = [
      ...messages,
      { role: "assistant", content: textContent(response.content).slice(0, 50_000) },
      {
        role: "user",
        content: `Your response was not valid for the required JSON shape. Correct it and return only the complete JSON object. Validation error: ${errorMessage(firstError)}`,
      },
    ];
    const repaired = await model.invoke(repairMessages);
    return parseBundlePlan(repaired.content);
  }
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
