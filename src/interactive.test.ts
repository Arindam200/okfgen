import { describe, expect, it } from "vitest";
import { commandHelpText, firstRunMarkerPath, splitCommandLine } from "./interactive.js";

describe("interactive shell", () => {
  it("parses quoted slash-command arguments", () => {
    expect(splitCommandLine('generate "Document the payments API" --source "docs/api spec"')).toEqual([
      "generate", "Document the payments API", "--source", "docs/api spec",
    ]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => splitCommandLine('generate "unfinished')).toThrow("Unclosed quote");
  });

  it("keeps the first-run marker with the user configuration", () => {
    expect(firstRunMarkerPath({ HOME: "/tmp/home" })).toBe("/tmp/home/.okfgen/welcome-shown");
  });

  it("documents every interactive command with slash syntax", () => {
    const help = commandHelpText();
    for (const command of ["/generate", "/update", "/view", "/validate", "/providers", "/provider", "/model", "/api-key", "/status", "/config", "/commands", "/exit"]) {
      expect(help).toContain(command);
    }
  });
});
