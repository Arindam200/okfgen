import { z } from "zod";

const safeConceptPath = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_./-]*\.md$/, "must be a relative .md path")
  .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), {
    message: "must remain inside the bundle",
  })
  .refine((value) => !["index.md", "log.md"].includes(value.split("/").at(-1) ?? ""), {
    message: "index.md and log.md are reserved",
  });

export const conceptSchema = z.object({
  path: safeConceptPath,
  type: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  resource: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  body: z.string().trim().min(1),
  metadata: z.record(z.string(), z.json()).optional(),
});

export const bundlePlanSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  concepts: z.array(conceptSchema).min(1).max(100),
});

export type Concept = z.infer<typeof conceptSchema>;
export type BundlePlan = z.infer<typeof bundlePlanSchema>;
