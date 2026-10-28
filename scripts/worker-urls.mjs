// After `tsc`, in a package's dist/: `new URL('./x.ts', import.meta.url)` becomes `new URL('./x.js', import.meta.url)`. tsc rewrites
// the extensions of imports (rewriteRelativeImportExtensions) but not of URLs, and a worker is started from a URL (io's worker.ts), so
// the source keeps '.ts' for the examples (which run the source) and the build points at the emitted file. Fails when a URL names a
// file that is not in dist/, and when a `new URL(` of a '.ts' file is left that the rewrite did not recognise (another tsc output). Run from a package's build script:  node ../../scripts/worker-urls.mjs
import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist');
const URL_TS = /new URL\((['"])(\.{1,2}\/[^'"]+)\.ts\1, import\.meta\.url\)/g;
const LEFT = /new URL\(\s*(['"`])[^'"`]*\.ts\1/;
for (const f of fs.readdirSync(dist, { recursive: true })) {
  if (!f.endsWith('.js') || f.startsWith('browser')) continue;
  const file = path.join(dist, f);
  const code = fs.readFileSync(file, 'utf8');
  const out = code.replace(URL_TS, (_m, q, rel) => {
    if (!fs.existsSync(path.resolve(path.dirname(file), `${rel}.js`))) throw new Error(`${f}: ${rel}.js is not in dist/`);
    return `new URL(${q}${rel}.js${q}, import.meta.url)`;
  });
  const left = LEFT.exec(out);
  if (left) throw new Error(`${f}: a URL of a .ts file is left after the rewrite: ${left[0]}`);
  if (out !== code) fs.writeFileSync(file, out);
}
