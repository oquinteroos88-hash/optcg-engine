import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The engine barrel reaches node:assert (assertSerializationRoundTrip);
      // the client never calls it, so a throwing shim keeps the browser happy.
      'node:assert': fileURLToPath(new URL('./src/shims/node-assert.ts', import.meta.url)),
    },
  },
});
