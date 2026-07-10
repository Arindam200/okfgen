import { describe, expect, it } from "vitest";
import { bundlePlanSchema } from "./schema.js";
import { parseBundlePlan } from "./model-output.js";

describe("OKF bundle plans", () => {
  it("accepts a minimal concept and rejects reserved paths", () => {
    const plan = bundlePlanSchema.parse({
      title: "Catalog",
      description: "A catalog.",
      concepts: [{ path: "tables/orders.md", type: "Table", title: "Orders", description: "Orders.", body: "# Schema\n" }],
    });
    expect(plan.concepts[0]?.tags).toEqual([]);
    expect(() => bundlePlanSchema.parse({ ...plan, concepts: [{ ...plan.concepts[0], path: "index.md" }] })).toThrow();
  });

  it("extracts a JSON plan from a fenced model response", () => {
    const plan = parseBundlePlan("```json\n{\"title\":\"X\",\"description\":\"Y\",\"concepts\":[{\"path\":\"x.md\",\"type\":\"Reference\",\"title\":\"X\",\"description\":\"Y\",\"body\":\"Body\"}]}\n```");
    expect(plan.title).toBe("X");
  });
});
