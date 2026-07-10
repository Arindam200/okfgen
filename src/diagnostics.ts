import { providerNames, providers } from "./providers.js";

const runtimeSecrets = new Map<string, string>();

export function registerDiagnosticSecret(key: string, value: string): void {
  if (value.trim()) runtimeSecrets.set(key, value.trim());
}

export function sanitizeDiagnosticText(input: string, environment = process.env): string {
  let output = input;
  for (const name of providerNames) {
    const key = providers[name].envKey;
    const secret = key ? environment[key]?.trim() : undefined;
    if (secret) output = output.split(secret).join(`[REDACTED:${key}]`);
  }
  for (const [key, secret] of runtimeSecrets) output = output.split(secret).join(`[REDACTED:${key}]`);
  return output
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:or-v1-)?[A-Za-z0-9_-]+/gi, "[REDACTED:API_KEY]");
}

export function friendlyError(error: unknown): string {
  const raw = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
  const status = typeof error === "object" && error !== null
    ? Number((error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode)
    : undefined;
  if (status === 401 || status === 403 || /unauthori[sz]ed|invalid api key/i.test(raw)) {
    return "The provider rejected the credential. Check the exported API key or update it with /api-key.";
  }
  if (status === 404) return "The provider could not find that model or endpoint. Check /model and /status.";
  if (status === 429 || /rate.?limit/i.test(raw)) return "The provider rate limit was reached. Wait briefly, then retry or switch models with /model.";
  if ((status && status >= 500) || /internal server error|service unavailable/i.test(raw)) {
    return "The provider is temporarily unavailable. Retry the command or switch models with /model.";
  }
  if (/timeout|timed out|abort/i.test(raw)) return "The provider did not respond in time. Check the endpoint and try again.";
  return raw;
}
