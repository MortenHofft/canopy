import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dataPlugin } from '../../scripts/vite-data.mjs';

// The test page resolves the workspace packages to their TypeScript source (the '@gbif-phylo/source' export condition), so it always
// tests the code in the tree, not a stale build. data/ is served at /data for the scripts that load trees in the page.
export default defineConfig({
  base: './',
  plugins: [react(), dataPlugin()],
  resolve: { conditions: ['@gbif-phylo/source'] },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
