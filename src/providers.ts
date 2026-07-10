import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOpenRouter } from "@langchain/openrouter";

export const providerNames = ["nebius", "openrouter", "ollama", "openai", "anthropic"] as const;
export type ProviderName = (typeof providerNames)[number];

export interface ProviderDefinition {
  label: string;
  hint: string;
  envKey?: string;
  defaultModel?: string;
  requiresKey: boolean;
  models?: string[];
}

export const providers: Record<ProviderName, ProviderDefinition> = {
  nebius: {
    label: "Nebius Token Factory",
    hint: "Hosted open-source models through an OpenAI-compatible API",
    envKey: "NEBIUS_API_KEY",
    requiresKey: true,
  },
  openrouter: {
    label: "OpenRouter",
    hint: "Open and proprietary models through one routing API",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-oss-120b",
    requiresKey: true,
    models: ["openai/gpt-oss-120b", "anthropic/claude-3.7-sonnet", "google/gemini-2.5-flash"],
  },
  ollama: {
    label: "Ollama",
    hint: "Local models with no API key",
    defaultModel: "qwen3:8b",
    requiresKey: false,
    models: ["qwen3:8b", "llama3.2:3b", "mistral:7b"],
  },
  openai: {
    label: "OpenAI",
    hint: "OpenAI API models",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-5.4-mini",
    requiresKey: true,
    models: ["gpt-5.4-mini", "gpt-4.1-mini"],
  },
  anthropic: {
    label: "Anthropic",
    hint: "Claude models through the Anthropic API",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
    requiresKey: true,
    models: ["claude-sonnet-4-6", "claude-haiku-4-5"],
  },
};

export interface ModelOptions {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxRetries?: number;
}

export function createChatModel(options: ModelOptions): BaseChatModel {
  const temperature = options.temperature ?? 0.1;

  switch (options.provider) {
    case "nebius":
      return new ChatOpenAI({
        model: options.model,
        apiKey: requireApiKey(options),
        temperature,
        maxRetries: options.maxRetries,
        streamUsage: false,
        configuration: {
          baseURL: options.baseUrl ?? "https://api.tokenfactory.nebius.com/v1/",
        },
      });
    case "openrouter":
      return new ChatOpenRouter({
        model: options.model,
        apiKey: requireApiKey(options),
        temperature,
        maxRetries: options.maxRetries,
        siteName: "OKFgen",
      });
    case "ollama":
      return new ChatOllama({
        model: options.model,
        baseUrl: options.baseUrl ?? "http://127.0.0.1:11434",
        temperature,
        maxRetries: options.maxRetries,
      });
    case "openai":
      return new ChatOpenAI({
        model: options.model,
        apiKey: requireApiKey(options),
        temperature,
        maxRetries: options.maxRetries,
      });
    case "anthropic":
      return new ChatAnthropic({
        model: options.model,
        anthropicApiKey: requireApiKey(options),
        temperature,
        maxRetries: options.maxRetries,
      });
  }
}

export function resolveApiKey(provider: ProviderName, explicit?: string): string | undefined {
  const envKey = providers[provider].envKey;
  return explicit?.trim() || (envKey ? process.env[envKey]?.trim() : undefined);
}

export async function fetchNebiusModels(
  apiKey: string,
  baseUrl = "https://api.tokenfactory.nebius.com/v1/",
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const endpoint = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403
      ? "Check that your API key is valid."
      : "Try again or verify the Token Factory endpoint.";
    throw new Error(`Could not load Nebius models (HTTP ${response.status}). ${detail}`);
  }

  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  const models = [...new Set((payload.data ?? [])
    .map((model) => typeof model.id === "string" ? model.id.trim() : "")
    .filter(Boolean))];
  if (models.length === 0) throw new Error("Nebius returned an empty model catalog.");
  return models.sort((left, right) => formatModelLabel(left).localeCompare(formatModelLabel(right)));
}

export function formatModelLabel(modelId: string): string {
  const [rawOwner, ...modelParts] = modelId.split("/");
  if (modelParts.length === 0) return formatModelName(rawOwner ?? modelId);
  const owner = formatOwner(rawOwner ?? "");
  let modelName = formatModelName(modelParts.join("/"));
  if (owner === "Meta" && modelName.startsWith("Meta ")) modelName = modelName.slice(5);
  return `${modelName} (${owner})`;
}

function formatOwner(owner: string): string {
  const known: Record<string, string> = {
    openai: "OpenAI",
    "meta-llama": "Meta",
    "deepseek-ai": "DeepSeek",
    qwen: "Qwen",
    moonshotai: "Moonshot AI",
    mistralai: "Mistral AI",
    microsoft: "Microsoft",
    google: "Google",
    nvidia: "NVIDIA",
  };
  return known[owner.toLowerCase()] ?? formatModelName(owner);
}

function formatModelName(value: string): string {
  const acronyms: Record<string, string> = {
    ai: "AI", api: "API", coder: "Coder", gpt: "GPT", oss: "OSS", llm: "LLM",
    vl: "VL", vla: "VLA", r1: "R1", v2: "V2", v3: "V3", moe: "MoE",
  };
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\//g, " / ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (acronyms[lower]) return acronyms[lower];
      if (/^\d+(?:\.\d+)?[a-z]$/i.test(token)) return token.toUpperCase();
      if (/^[rv]\d+(?:\.\d+)*$/i.test(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

function requireApiKey(options: ModelOptions): string {
  const apiKey = resolveApiKey(options.provider, options.apiKey);
  if (!apiKey) {
    throw new Error(`Missing API key for ${providers[options.provider].label}. Set ${providers[options.provider].envKey} or use --api-key.`);
  }
  return apiKey;
}
