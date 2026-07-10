import { describe, expect, it } from "vitest";
import { buildGenerationMessages } from "./prompt.js";

describe("generation prompts", () => {
  it("instructs the model to improve an existing bundle as a complete replacement", () => {
    const messages = buildGenerationMessages(
      "Refresh the API documentation",
      "The current API schema",
      "===== SOURCE: docs/auth.md =====\nExisting authentication guidance",
    );
    const system = String((messages[0] as { content: string }).content);
    const user = String((messages[1] as { content: string }).content);

    expect(system).toContain("complete improved replacement plan, not a patch or partial list");
    expect(system).toContain("Preserve accurate existing knowledge");
    expect(user).toContain("Existing OKF bundle to improve:");
    expect(user).toContain("Existing authentication guidance");
  });
});
