import { defineConfig } from 'vite';
import { buildInfo } from '../scripts/build-info.mjs';

// Build facts for the footer: Vercel's variables when it builds, git otherwise.
export default defineConfig({
  base: '/',
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
