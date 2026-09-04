import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // A stray `.only` fails the run here as well as under CI's default.
    allowOnly: false,
    include: ['tests/**/*.test.ts'],
  },
});
