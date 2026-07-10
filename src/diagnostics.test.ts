import { describe, expect, it } from "vitest";
import { friendlyError, registerDiagnosticSecret, sanitizeDiagnosticText } from "./diagnostics.js";

describe("diagnostics", () => {
  it("redacts configured and recognizable credentials", () => {
    registerDiagnosticSecret("EXPLICIT_KEY", "one-off-secret");
    expect(sanitizeDiagnosticText("Bearer abc123 secret-value sk-or-v1-token", { OPENAI_API_KEY: "secret-value" }))
      .toBe("Bearer [REDACTED] [REDACTED:OPENAI_API_KEY] [REDACTED:API_KEY]");
    expect(sanitizeDiagnosticText("failed with one-off-secret", {})).toBe("failed with [REDACTED:EXPLICIT_KEY]");
  });

  it("turns provider status codes into actionable messages", () => {
    expect(friendlyError(Object.assign(new Error("no"), { status: 401 }))).toContain("/api-key");
    expect(friendlyError(Object.assign(new Error("no"), { statusCode: 429 }))).toContain("rate limit");
    expect(friendlyError(Object.assign(new Error("no"), { status: 503 }))).toContain("temporarily unavailable");
    expect(friendlyError(Object.assign(new Error("no"), { status: 404 }))).toContain("/model");
    expect(friendlyError(new Error("request timed out"))).toContain("did not respond");
  });
});
