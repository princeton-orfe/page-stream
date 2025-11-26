import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    setupFiles: ['./tests/e2e/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000, // Allow more time for service startup
    // Don't run in parallel to avoid race conditions against the API
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
