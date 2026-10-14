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
      reporter: ["text", "lcov", "json-summary"],
      include: [
        "src/**/*.ts",
        "packages/sdk/src/**/*.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/dist/**",
      ],
      thresholds: {
        statements: 44,
        branches: 37,
        functions: 49,
        lines: 45,
      },
    },
    // Longer timeout for tests that import heavy deps (GramJS, @ton/ton)
    testTimeout: 10_000,
  },
});