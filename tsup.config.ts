import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

// Bundle everything EXCEPT production dependencies and Node builtins.
// This ensures @ston-fi/* (devDeps with pnpm-only install blocker)
// and all their transitive deps are inlined into dist/.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
];

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: "esm",
  target: "node20",
  platform: "node",
  splitting: true,
  clean: true,
  dts: false,
  sourcemap: false,
  outDir: "dist",
  external,
});
