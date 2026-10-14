import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCachePath: "node_modules/.vitest-web-cache",
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
  },
});
