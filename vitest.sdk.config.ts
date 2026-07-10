import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/sdk/**/__tests__/**/*.test.ts", "packages/sdk/src/**/__tests__/**/*.test.ts"],
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/sdk/**/*.ts", "packages/sdk/src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/dist/**"],
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 90,
        lines: 82,
      },
    },
  },
});
