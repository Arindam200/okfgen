import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { providerNames, providers, type ProviderName } from "./providers.js";

export const OKFGEN_PROVIDER_ENV_KEY = "OKFGEN_PROVIDER";
export const OKFGEN_MODEL_ENV_KEY = "OKFGEN_MODEL";
export const OKFGEN_BASE_URL_ENV_KEY = "OKFGEN_BASE_URL";
export const OKFGEN_RETRY_ATTEMPTS_ENV_KEY = "OKFGEN_RETRY_ATTEMPTS";
export const okfgenEnvDirectory = path.join(os.homedir(), ".okfgen");
export const okfgenEnvPath = path.join(okfgenEnvDirectory, ".env");

export const managedEnvKeys = [
  OKFGEN_PROVIDER_ENV_KEY,
  OKFGEN_MODEL_ENV_KEY,
  OKFGEN_BASE_URL_ENV_KEY,
  OKFGEN_RETRY_ATTEMPTS_ENV_KEY,
  ...providerNames.flatMap((name) => providers[name].envKey ? [providers[name].envKey] : []),
] as const;

type EnvMap = Record<string, string>;
export type ConfigSource = "flag" | "terminal" | "saved" | "terminal over saved" | "session" | "default" | "unset";
export interface ResolvedConfigValue {
  value?: string;
  source: ConfigSource;
  envKey?: string;
}

let savedEnv: EnvMap = {};
const inheritedKeys = new Set<string>();
const inheritedValues = new Map<string, string>();
const sessionKeys = new Set<string>();

export async function loadOkfgenEnv(filePath = okfgenEnvPath, environment = process.env): Promise<EnvMap> {
  inheritedKeys.clear();
  inheritedValues.clear();
  savedEnv = await readEnvFile(filePath);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (environment[key] === undefined) environment[key] = value;
    else {
      inheritedKeys.add(key);
      inheritedValues.set(key, environment[key]!);
    }
  }
  for (const key of managedEnvKeys) {
    if (environment[key] !== undefined && savedEnv[key] === undefined) {
      inheritedKeys.add(key);
      inheritedValues.set(key, environment[key]!);
    }
  }
  return { ...savedEnv };
}

export async function saveOkfgenEnv(updates: EnvMap, filePath = okfgenEnvPath, environment = process.env): Promise<void> {
  const current = await readEnvFile(filePath);
  const next = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    if (value.trim()) next[key] = value.trim();
    else delete next[key];
  }
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  await writeFile(filePath, formatEnv(next), { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  savedEnv = next;
  for (const [key, value] of Object.entries(updates)) {
    const clean = value.trim();
    if (clean && (environment[key] === undefined || environment[key] === current[key])) environment[key] = clean;
    if (!clean) {
      const inherited = inheritedValues.get(key);
      if (inherited !== undefined) environment[key] = inherited;
      else if (environment[key] === current[key]) delete environment[key];
      sessionKeys.delete(key);
    }
  }
}

export function setSessionConfig(key: string, value: string, environment = process.env): void {
  environment[key] = value.trim();
  sessionKeys.add(key);
}

export function resolveConfigValue(key: string, explicit?: string, environment = process.env): ResolvedConfigValue {
  const cleanExplicit = explicit?.trim();
  if (cleanExplicit) return { value: cleanExplicit, source: "flag" };
  const value = environment[key]?.trim();
  if (!value) return { source: "unset", envKey: key };
  if (sessionKeys.has(key)) return { value, source: "session", envKey: key };
  if (inheritedKeys.has(key) && savedEnv[key] !== undefined) return { value, source: "terminal over saved", envKey: key };
  if (inheritedKeys.has(key)) return { value, source: "terminal", envKey: key };
  if (savedEnv[key] !== undefined) return { value, source: "saved", envKey: key };
  return { value, source: "terminal", envKey: key };
}

export function resolveProvider(explicit?: string, environment = process.env): ResolvedConfigValue {
  if (explicit) return { value: explicit, source: "flag" };
  const configured = resolveConfigValue(OKFGEN_PROVIDER_ENV_KEY, undefined, environment);
  if (configured.value) return configured;
  const detected = providerNames.filter((name) => {
    const key = providers[name].envKey;
    return key && environment[key]?.trim();
  });
  if (detected.length === 1) {
    const provider = detected[0]!;
    return { value: provider, source: resolveConfigValue(providers[provider].envKey!, undefined, environment).source, envKey: providers[provider].envKey };
  }
  return { source: "unset", envKey: OKFGEN_PROVIDER_ENV_KEY };
}

export function getCredentialStatus(provider: ProviderName, environment = process.env): ResolvedConfigValue {
  const key = providers[provider].envKey;
  return key ? resolveConfigValue(key, undefined, environment) : { source: "default" };
}

export function resolveRetryAttempts(environment = process.env): number {
  const raw = resolveConfigValue(OKFGEN_RETRY_ATTEMPTS_ENV_KEY, undefined, environment).value;
  if (!raw) return 3;
  const attempts = Number(raw);
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 10) {
    throw new Error(`${OKFGEN_RETRY_ATTEMPTS_ENV_KEY} must be an integer from 0 to 10.`);
  }
  return attempts;
}

export function parseEnv(content: string): EnvMap {
  const result: EnvMap = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    const rawValue = line.slice(equals + 1).trim();
    result[key] = parseEnvValue(rawValue);
  }
  return result;
}

export function formatEnv(environment: EnvMap): string {
  const order = new Map<string, number>(managedEnvKeys.map((key, index) => [key, index]));
  return Object.entries(environment)
    .sort(([left], [right]) => (order.get(left) ?? 10_000) - (order.get(right) ?? 10_000) || left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + (Object.keys(environment).length ? "\n" : "");
}

async function readEnvFile(filePath: string): Promise<EnvMap> {
  try {
    return parseEnv(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function parseEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}
