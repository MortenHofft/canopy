import { defineConfig } from 'vite';
import { dataPlugin } from '../../scripts/vite-data.mjs';

// Inside the repository the packages resolve to their TypeScript source (the '@canopy/source' export condition); an app installing
// them from npm needs none of this. data/ is served at /data.
export default defineConfig({
  base: './',
  plugins: [dataPlugin()],
  resolve: { conditions: ['@canopy/source'] },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
