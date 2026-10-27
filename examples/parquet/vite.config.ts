import { defineConfig } from 'vite';

// Inside the repository the packages resolve to their TypeScript source (the '@gbif-phylo/source' export condition). The dataset is not
// served by Vite: it comes from scripts/serve.mjs (range requests), whose address is the page's ?url=.
export default defineConfig({
  base: './',
  resolve: { conditions: ['@gbif-phylo/source'] },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
