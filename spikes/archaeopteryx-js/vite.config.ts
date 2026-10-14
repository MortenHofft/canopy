import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spikeConfig } from '../shared/vite.base.mjs';

// 1. phyloxml.js (a dependency of archaeopteryx) reads a bare `global` at load time (phyloxml.js:91). The
//    production build rewrites it, the dev server's pre-bundle does not, so `define` makes both behave the same.
// 2. LGPL-3.0: the library's own code is split into its own chunk (assets/archaeopteryx-*.js) so that it is a
//    separate file in dist/. It is still minified and wrapped by the bundler, so it is NOT the byte-identical
//    npm file; see docs/results/archaeopteryx-js.md for what that means for "replaceable library".
export default defineConfig(
  spikeConfig({
    root: __dirname,
    plugins: [react()],
    overrides: {
      define: { global: 'globalThis' },
      build: {
        target: 'es2022',
        sourcemap: false,
        minify: 'esbuild',
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 4000,
        assetsInlineLimit: 0,
        rollupOptions: {
          output: {
            manualChunks(id: string) {
              if (id.includes('/node_modules/archaeopteryx/')) return 'archaeopteryx';
              if (id.includes('/node_modules/phyloxml/') || id.includes('/node_modules/sax/')) return 'phyloxml';
              if (id.includes('/node_modules/d3') || id.includes('/node_modules/internmap/') || id.includes('/node_modules/delaunator/') || id.includes('/node_modules/robust-predicates/')) return 'd3';
              return undefined;
            },
          },
        },
      },
    },
  }),
);
