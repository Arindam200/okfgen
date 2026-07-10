import { describe, expect, it, vi } from "vitest";
import { fetchNebiusModels, formatModelLabel, resolveApiKey } from "./providers.js";

describe("Nebius model discovery", () => {
  it("prefers an explicit key and trims terminal credentials", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "  terminal  ";
    try {
      expect(resolveApiKey("openai")).toBe("terminal");
      expect(resolveApiKey("openai", " explicit ")).toBe("explicit");
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });
  it("formats model IDs for people without changing the underlying ID", () => {
    expect(formatModelLabel("openai/gpt-oss-120b")).toBe("GPT OSS 120B (OpenAI)");
    expect(formatModelLabel("meta-llama/Meta-Llama-3.3-70B-Instruct")).toBe("Llama 3.3 70B Instruct (Meta)");
    expect(formatModelLabel("deepseek-ai/DeepSeek-R1-0528")).toBe("DeepSeek R1 0528 (DeepSeek)");
  });

  it("loads, deduplicates, and sorts the live model catalog", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.tokenfactory.nebius.com/v1/models");
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
      return new Response(JSON.stringify({
        data: [
          { id: "Qwen/Qwen3-32B-fast" },
          { id: "openai/gpt-oss-120b" },
          { id: "Qwen/Qwen3-32B-fast" },
          { object: "model" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(fetchNebiusModels("secret", undefined, fetchImpl as typeof fetch)).resolves.toEqual([
      "openai/gpt-oss-120b",
      "Qwen/Qwen3-32B-fast",
    ]);
  });

  it("surfaces invalid credentials without exposing the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    await expect(fetchNebiusModels("do-not-print", undefined, fetchImpl as typeof fetch))
      .rejects.toThrow("Could not load Nebius models (HTTP 401). Check that your API key is valid.");
  });
});
