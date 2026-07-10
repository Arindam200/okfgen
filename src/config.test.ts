import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatEnv, loadOkfgenEnv, parseEnv, resolveConfigValue, resolveProvider, resolveRetryAttempts, saveOkfgenEnv } from "./config.js";

describe("OKFgen environment configuration", () => {
  it("round-trips quoted values", () => {
    const values = { OKFGEN_MODEL: "model with spaces", OPENAI_API_KEY: 'a"b\\c' };
    expect(parseEnv(formatEnv(values))).toEqual(values);
  });

  it("lets the terminal environment override saved values and reports both", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-config-"));
    const file = path.join(root, ".env");
    const environment: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: "terminal-key" };
    await saveOkfgenEnv({ OPENROUTER_API_KEY: "saved-key" }, file, {});
    await loadOkfgenEnv(file, environment);
    expect(environment.OPENROUTER_API_KEY).toBe("terminal-key");
    expect(resolveConfigValue("OPENROUTER_API_KEY", undefined, environment).source).toBe("terminal over saved");
  });

  it("infers a provider only when exactly one provider credential exists", () => {
    expect(resolveProvider(undefined, { OPENAI_API_KEY: "secret" }).value).toBe("openai");
    expect(resolveProvider(undefined, { OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b" }).value).toBeUndefined();
  });

  it("writes saved credentials with private permissions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-config-"));
    const directory = path.join(root, ".okfgen");
    const file = path.join(directory, ".env");
    await saveOkfgenEnv({ OPENAI_API_KEY: "secret" }, file, {});
    expect(await readFile(file, "utf8")).not.toContain("undefined");
    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it("loads saved values only when the terminal has no value", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-config-"));
    const file = path.join(root, ".env");
    const environment: NodeJS.ProcessEnv = {};
    await saveOkfgenEnv({ OKFGEN_MODEL: "saved-model" }, file, {});
    await loadOkfgenEnv(file, environment);
    expect(environment.OKFGEN_MODEL).toBe("saved-model");
    expect(resolveConfigValue("OKFGEN_MODEL", undefined, environment).source).toBe("saved");
  });

  it("does not erase an inherited terminal value when saved preferences are reset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okfgen-config-"));
    const file = path.join(root, ".env");
    const environment: NodeJS.ProcessEnv = { OKFGEN_MODEL: "terminal-model" };
    await saveOkfgenEnv({ OKFGEN_MODEL: "saved-model" }, file, {});
    await loadOkfgenEnv(file, environment);
    await saveOkfgenEnv({ OKFGEN_MODEL: "" }, file, environment);
    expect(environment.OKFGEN_MODEL).toBe("terminal-model");
    expect(await readFile(file, "utf8")).not.toContain("OKFGEN_MODEL");
  });

  it("validates retry configuration", () => {
    expect(resolveRetryAttempts({})).toBe(3);
    expect(resolveRetryAttempts({ OKFGEN_RETRY_ATTEMPTS: "0" })).toBe(0);
    expect(() => resolveRetryAttempts({ OKFGEN_RETRY_ATTEMPTS: "11" })).toThrow("0 to 10");
    expect(() => resolveRetryAttempts({ OKFGEN_RETRY_ATTEMPTS: "many" })).toThrow("0 to 10");
  });
});
