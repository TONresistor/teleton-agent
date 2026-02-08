import { defineConfig } from "tsup";

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
  // All deps stay in node_modules (not bundled)
  // Critical for native modules (better-sqlite3, sqlite-vec, playwright)
  // Exception: @ston-fi/api is bundled because it enforces pnpm-only install
  noExternal: [],
  skipNodeModulesBundle: true,
});
