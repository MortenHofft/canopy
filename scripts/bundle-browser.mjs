// The single-file browser build of a package, for pages without a build step: `src/index.ts` bundled by esbuild into one minified ES
// module, `dist/browser/<name>.js` (with a source map), exported as `<package>/browser`. Bundler users keep importing the per-file
// `dist/` (tree-shakeable); this file is for `<script type="module">` and import maps. Run from a package's build script:
//   node ../../scripts/bundle-browser.mjs <name> [entry]     (entry default: src/index.ts)
// A worker started by `new URL('./x.ts', import.meta.url)` is a file of its own next to the build: the URL then names the bundle of
// that worker, `dist/browser/<package name>-x.js` (built by another call, with the worker as the entry).
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const name = process.argv[2];
if (!name) throw new Error('usage: bundle-browser.mjs <name> [entry]');
const entry = process.argv[3] ?? 'src/index.ts';
const pkg = process.cwd();
const prefix = name.split('-')[0];
await esbuild.build({
  entryPoints: [path.join(pkg, entry)],
  outfile: path.join(pkg, 'dist/browser', `${name}.js`),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [
    {
      name: 'worker-urls',
      setup: (build) =>
        build.onLoad({ filter: /\.ts$/ }, async (a) => {
          const code = await fs.promises.readFile(a.path, 'utf8');
          const out = code.replace(/new URL\((['"])\.\/([\w-]+)\.ts\1, import\.meta\.url\)/g, `new URL($1./${prefix}-$2.js$1, import.meta.url)`);
          return { contents: out, loader: 'ts' };
        }),
    },
  ],
});
