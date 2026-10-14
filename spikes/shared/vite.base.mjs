// Shared Vite configuration for spike candidates. Plain Node ESM with no imports from 'vite' or React, so it
// resolves from any candidate folder; the candidate passes its own @vitejs/plugin-react.
//
//   // spikes/<candidate>/vite.config.ts
//   import { defineConfig } from 'vite';
//   import react from '@vitejs/plugin-react';
//   import { spikeConfig } from '../shared/vite.base.mjs';
//   export default defineConfig(spikeConfig({ root: __dirname, plugins: [react()] }));
//
// What it does
//  * serves the repository's data/ directory at /data/ in dev AND in `vite preview` (nothing from data/ is
//    copied into dist/, so bundle size stays honest). .gz files are sent as raw bytes with
//    Content-Type application/gzip and no Content-Encoding; shared/data.ts inflates them in the browser.
//  * aliases react / react-dom to the candidate's own node_modules so shared/app-shell.tsx and the candidate
//    use ONE copy of React (shared/ lives outside the candidate folder).
//  * production build with relative base, es2022 target, no sourcemaps, esbuild minification.
//  * allows the dev server to read ../shared and ../../data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPIKES_DIR = path.resolve(here, '..');
export const DATA_DIR = path.resolve(here, '../../data');

const TYPES = {
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.nwk': 'text/plain; charset=utf-8',
  '.tre': 'text/plain; charset=utf-8',
  '.nex': 'text/plain; charset=utf-8',
  '.nhx': 'text/plain; charset=utf-8',
  '.fa': 'text/plain; charset=utf-8',
  '.fasta': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** Connect middleware mounted at /data. */
export function dataMiddleware(dataDir = DATA_DIR) {
  const root = path.resolve(dataDir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try {
      rel = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.statusCode = 400;
      return res.end('bad path');
    }
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.statusCode = 403;
      return res.end('forbidden');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        return res.end(`not found under data/: ${rel}`);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  };
}

export function dataPlugin(dataDir = DATA_DIR) {
  const mw = dataMiddleware(dataDir);
  return {
    name: 'spike-data',
    configureServer(server) {
      server.middlewares.use('/data', mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data', mw);
    },
  };
}

/**
 * @param {{ root: string, plugins?: any[], overrides?: Record<string, any> }} o
 */
export function spikeConfig({ root, plugins = [], overrides = {} }) {
  const nm = (p) => path.join(root, 'node_modules', p);
  const dedupe = ['react', 'react-dom'];
  return {
    root,
    base: './',
    plugins: [dataPlugin(), ...plugins],
    resolve: {
      alias: [
        { find: /^react$/, replacement: nm('react') },
        { find: /^react\/(.*)$/, replacement: nm('react') + '/$1' },
        { find: /^react-dom$/, replacement: nm('react-dom') },
        { find: /^react-dom\/(.*)$/, replacement: nm('react-dom') + '/$1' },
      ],
      dedupe,
    },
    server: { host: '127.0.0.1', fs: { allow: [SPIKES_DIR, path.resolve(SPIKES_DIR, '..')] } },
    preview: { host: '127.0.0.1' },
    build: {
      target: 'es2022',
      sourcemap: false,
      minify: 'esbuild',
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 4000,
      assetsInlineLimit: 0,
    },
    ...overrides,
  };
}
