import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessageLike } from "@langchain/core/messages";
import path from "node:path";
import { createChatModel, type ModelOptions } from "./providers.js";
import { inspectExistingBundle } from "./existing-bundle.js";
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
  onProgress?: (event: GenerationProgress) => void;
}

export interface GenerationProgress {
  stage: "inspect" | "sources" | "model" | "repair" | "write" | "validate";
  message: string;
}

export interface GenerateResult {
  mode: "created" | "updated";
  plan: BundlePlan;
  files: string[];
  validation: ValidationResult;
}

export async function generateBundle(options: GenerateOptions): Promise<GenerateResult> {
  options.onProgress?.({ stage: "inspect", message: "Checking the output directory" });
  const existingBundle = await inspectExistingBundle(options.outputDirectory);
  options.onProgress?.({ stage: "sources", message: options.sources?.length ? `Reading ${options.sources.length} source${options.sources.length === 1 ? "" : "s"}` : "Preparing generation context" });
  const context = await loadSources(options.sources ?? []);
  const existingLogPath = existingBundle ? path.join(existingBundle.root, "log.md") : undefined;
  const existingBundleContext = existingBundle ? await loadSources([existingBundle.root], {
    filter: (file) => file !== existingLogPath,
  }) : "";
  const messages = buildGenerationMessages(options.request, context, existingBundleContext);
  const model = options.modelInstance ?? createChatModel(options);
  options.onProgress?.({ stage: "model", message: existingBundle ? "Asking the model to improve the bundle" : "Asking the model to design the bundle" });
  const plan = await invokeForPlan(model, messages, options.onProgress);
  options.onProgress?.({ stage: "write", message: `Writing ${plan.concepts.length} concept${plan.concepts.length === 1 ? "" : "s"}` });
  const rendered = await renderBundle(plan, options.outputDirectory, {
    force: options.force,
    includeLog: options.includeLog,
  });
  options.onProgress?.({ stage: "validate", message: "Validating OKF v0.1 conformance" });
  const validation = await validateBundle(options.outputDirectory);
  if (!validation.valid) {
    const errors = validation.issues.filter((issue) => issue.severity === "error");
    throw new Error(`Generated bundle failed validation: ${errors.map((issue) => `${issue.file}: ${issue.message}`).join("; ")}`);
  }
  return { mode: rendered.mode, plan, files: rendered.files, validation };
}

async function invokeForPlan(model: BaseChatModel, messages: BaseMessageLike[], onProgress?: GenerateOptions["onProgress"]): Promise<BundlePlan> {
  const response = await model.invoke(messages);
  try {
    return parseBundlePlan(response.content);
  } catch (firstError) {
    onProgress?.({ stage: "repair", message: "Repairing the model response" });
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
