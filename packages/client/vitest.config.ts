import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` is here for the jsdom click-routing suite, which renders real
    // components. It opts into jsdom with a per-file docblock pragma so every
    // other suite keeps running in `node`.
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
