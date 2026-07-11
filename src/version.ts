import { createRequire } from "node:module";

// Both src/ and dist/ sit one level below package.json, so the relative
// lookup resolves correctly before and after bundling.
export const VERSION = createRequire(import.meta.url)("../package.json").version as string;
