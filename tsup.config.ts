import { defineConfig } from "tsup";
import { rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "./package.json" with { type: "json" };

// Bundle everything EXCEPT production dependencies and Node builtins.
// This ensures @ston-fi/* (devDeps with pnpm-only install blocker)
// and all their transitive deps are inlined into dist/.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
];

// Clean dist/ but preserve dist/web/ (Vite frontend build)
function cleanDistPreserveWeb() {
  try {
    for (const entry of readdirSync("dist")) {
      if (entry === "web") continue;
      rmSync(join("dist", entry), { recursive: true, force: true });
    }
  } catch {
    // dist/ doesn't exist yet — nothing to clean
  }
}

cleanDistPreserveWeb();

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: "esm",
  target: "node22",
  platform: "node",
  splitting: true,
  clean: false,
  dts: true,
  sourcemap: false,
  outDir: "dist",
  external,
});
