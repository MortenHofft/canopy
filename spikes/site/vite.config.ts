import { defineConfig } from 'vite';
import path from 'node:path';
import { dataPlugin } from '../shared/vite.base.mjs';

// Multi-page: index.html (hub) and compare.html. Relative base so the site works from any path.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [dataPlugin()],
  server: { host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '..'), path.resolve(__dirname, '../..')] } },
  preview: { host: '127.0.0.1' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        compare: path.resolve(__dirname, 'compare.html'),
      },
    },
  },
});
