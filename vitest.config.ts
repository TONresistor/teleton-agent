import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.ts",
      "packages/sdk/src/**/__tests__/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/**/*.ts",
        "packages/sdk/src/**/*.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
    // Longer timeout for tests that import heavy deps (GramJS, @ton/ton)
    testTimeout: 10_000,
  },
});
