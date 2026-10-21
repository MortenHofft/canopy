import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spikeConfig } from '../shared/vite.base.mjs';

// `vite build` builds the harness page (index.html) into dist/, which the runner measures as the candidate's bundle. `vite build --mode
// demo` builds only the standalone component demo (demo.html: <TreeView> plus the tree operations of packages/tree-ops) into dist-demo/,
// kept out of dist/ so it does not count towards the bundle; scripts/build-site.mjs publishes it at /custom/demo.
export default defineConfig(({ mode }) => {
  const config = spikeConfig({ root: __dirname, plugins: [react()] });
  if (mode !== 'demo') return config;
  return { ...config, build: { ...config.build, outDir: 'dist-demo', rollupOptions: { input: path.join(__dirname, 'demo.html') } } };
});
