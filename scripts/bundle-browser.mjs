// The single-file browser build of a package, for pages without a build step: `src/index.ts` bundled by esbuild into one minified ES
// module, `dist/browser/<name>.js` (with a source map), exported as `<package>/browser`. Bundler users keep importing the per-file
// `dist/` (tree-shakeable); this file is for `<script type="module">` and import maps. Run from a package's build script:
//   node ../../scripts/bundle-browser.mjs <name>
import path from 'node:path';
import * as esbuild from 'esbuild';

const name = process.argv[2];
if (!name) throw new Error('usage: bundle-browser.mjs <name>');
const pkg = process.cwd();
await esbuild.build({
  entryPoints: [path.join(pkg, 'src/index.ts')],
  outfile: path.join(pkg, 'dist/browser', `${name}.js`),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});
