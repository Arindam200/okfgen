import { defineConfig, type Options } from "tsup";

// TypeScript emits declarations separately; tsup's rollup declaration plugin
// is not compatible with the TypeScript version used by this package.
const shared: Options = {
  format: ["esm"],
  dts: false,
  sourcemap: true,
};

// The shebang banner belongs only on the executable entry, so the CLI and the
// library are built as separate configs. Both configs build concurrently, so
// neither may clean the output folder; the build script clears dist first.
export default defineConfig([
  {
    ...shared,
    entry: ["src/cli.ts"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    ...shared,
    entry: ["src/index.ts"],
  },
]);
