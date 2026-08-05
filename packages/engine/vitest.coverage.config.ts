import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts on purpose: this config runs ONLY the
// simulation sweep, so the coverage numbers describe what the bots actually
// reach — not what the unit tests reach. Mixing the two would hide exactly the
// gaps this measurement is looking for.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['coverage-run/*.test.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      reporter: ['text', 'json'],
      reportsDirectory: './coverage-report',
      thresholds: undefined,
    },
  },
});
