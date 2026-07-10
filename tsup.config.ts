import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  // TypeScript emits declarations separately; tsup's rollup declaration plugin
  // is not compatible with the TypeScript version used by this package.
  dts: false,
  sourcemap: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
