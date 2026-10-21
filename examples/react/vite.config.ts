import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dataPlugin } from '../../scripts/vite-data.mjs';

// Inside the repository the packages resolve to their TypeScript source (the '@gbif-phylo/source' export condition), so the example
// shows the code in the tree; an app installing the packages from npm needs none of this. data/ is served at /data.
export default defineConfig({
  base: './',
  plugins: [react(), dataPlugin()],
  resolve: { conditions: ['@gbif-phylo/source'] },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
