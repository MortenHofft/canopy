// Package checks, run after `npm run build`:
//  1. publint on every published package (errors and warnings fail; suggestions are printed);
//  2. `npm pack --dry-run`: the tarball holds dist/ (JS, declarations, maps), src/, css/ (viewer), README and LICENSE, nothing else;
//     the single-file browser build (`./browser` export) is there and imports nothing;
//  3. tree shaking: small apps importing one thing are bundled with esbuild from dist/ (the way a consumer's bundler sees the packages)
//     and the modules that must NOT end up in them are asserted absent; minified and gzipped sizes are printed.
//   node scripts/check-packages.mjs [--json out.json]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { publint } from 'publint';
import { formatMessage } from 'publint/utils';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['io', 'tree-ops', 'viewer', 'react'];
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

// ---- 1 and 2: publint and pack contents
const report = [];
const licence = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
for (const name of PACKAGES) {
  const dir = path.join(root, 'packages', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  console.log(`${pkg.name}`);
  ok(fs.existsSync(path.join(dir, 'dist', 'index.js')), 'dist/index.js exists (run `npm run build` first)');
  const { messages } = await publint({ pkgDir: dir, level: 'suggestion', strict: true });
  for (const m of messages) {
    const text = formatMessage(m, pkg) ?? m.code;
    if (m.type === 'suggestion') console.log(`  note ${text}`);
    else ok(false, `publint ${m.type}: ${text}`);
  }
  ok(!messages.some((m) => m.type !== 'suggestion'), 'publint: no errors or warnings');
  ok(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8') === licence, 'LICENSE is the repository licence');
  // every emitted module has a source module (a renamed or deleted source must not leave its old output in the package)
  const stale = fs
    .readdirSync(path.join(dir, 'dist'), { recursive: true })
    .filter((f) => f.endsWith('.js') && !f.startsWith('browser'))
    .filter((f) => !['.ts', '.tsx'].some((x) => fs.existsSync(path.join(dir, 'src', f.replace(/\.js$/, x)))));
  ok(stale.length === 0, `dist/ has no output without a source${stale.length ? ': ' + stale.join(', ') : ''}`);
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' }));
  const files = packed.files.map((f) => f.path);
  const unexpected = files.filter((f) => !/^(dist\/|src\/|css\/|README\.md$|LICENSE$|package\.json$)/.test(f));
  ok(
    unexpected.length === 0,
    `tarball holds only dist/, src/, css/, README, LICENSE, package.json${unexpected.length ? ': also ' + unexpected.join(', ') : ''}`,
  );
  ok(files.includes('dist/index.d.ts') && files.some((f) => f.endsWith('.js.map')), 'tarball has declarations and source maps');
  console.log(`  ${files.length} files, ${(packed.size / 1024).toFixed(1)} kB packed, ${(packed.unpackedSize / 1024).toFixed(1)} kB unpacked`);
  // the single-file browser build (pages without a build step): present, packed, self-contained
  const browser = pkg.exports['./browser'];
  if (browser) {
    const rel = (typeof browser === 'string' ? browser : browser.default).replace(/^\.\//, '');
    const file = path.join(dir, rel);
    ok(fs.existsSync(file) && files.includes(rel), `browser build ${rel} exists and is in the tarball`);
    if (fs.existsSync(file)) {
      const code = fs.readFileSync(file, 'utf8');
      // any import or export-from left in the bundle would need a resolver (an import map or a bundler); there must be none
      const left = code.match(/(?:\bimport\s*\(|\bfrom\s*["'`]|\bimport\s*["'`])/g) ?? [];
      ok(left.length === 0, `browser build has no imports left (${left.length})`);
      const gz = zlib.gzipSync(code, { level: 9 }).length;
      console.log(`  browser build: ${(code.length / 1024).toFixed(1)} kB min, ${(gz / 1024).toFixed(1)} kB gzip`);
      report.push({ name: `${pkg.name}/browser`, modules: 1, minBytes: code.length, gzipBytes: gz });
    }
  }
}

// ---- 3: tree shaking. `forbid` are substrings of bundled input paths (relative to the repository) that must be absent.
const SCENARIOS = [
  {
    name: 'io: parseNewick only',
    code: `import { parseNewick } from '@gbif-phylo/io'; console.log(parseNewick('(a,b);'));`,
    forbid: ['packages/io/dist/sidecar.js'],
  },
  {
    name: 'io: parseNewick + sidecar',
    code: `import { parseNewick, parseSidecar } from '@gbif-phylo/io'; const t = parseNewick('(a,b);'); console.log(parseSidecar('ID,x\\na,1').bind(t).categories('x'));`,
    forbid: [],
  },
  {
    // The annotation reader is part of the parser (`{ annotations: true }` is a plain option), so it is bundled with it: about 2.7 kB
    // minified more than parseNewick without it. Making it separable would need the caller to import and pass it in; not worth the API.
    name: 'io: parseNewick + annotations + supportFrom',
    code: `import { parseNewick, supportFrom } from '@gbif-phylo/io'; const t = parseNewick('(a,b);', { annotations: true }); console.log(supportFrom(t, 'p'));`,
    forbid: [],
  },
  {
    name: 'tree-ops: ladderise only',
    code: `import { ladderise } from '@gbif-phylo/tree-ops'; console.log(ladderise);`,
    forbid: [
      'packages/tree-ops/dist/rooting.js',
      'packages/tree-ops/dist/collapse.js',
      'packages/tree-ops/dist/subset.js',
      'packages/tree-ops/dist/bytes.js',
      'packages/tree-ops/dist/auto-collapse.js',
    ],
  },
  {
    name: 'tree-ops: treeBytes only',
    code: `import { treeBytes } from '@gbif-phylo/tree-ops'; console.log(treeBytes);`,
    forbid: [
      'packages/tree-ops/dist/rooting.js',
      'packages/tree-ops/dist/order.js',
      'packages/tree-ops/dist/collapse.js',
      'packages/tree-ops/dist/subset.js',
      'packages/tree-ops/dist/focus.js',
      'packages/tree-ops/dist/follow.js',
      'packages/tree-ops/dist/auto-collapse.js',
    ],
  },
  {
    name: 'tree-ops: followClade, composeMaps only',
    code: `import { followClade, composeMaps } from '@gbif-phylo/tree-ops'; console.log(followClade, composeMaps);`,
    forbid: [
      'packages/tree-ops/dist/rooting.js',
      'packages/tree-ops/dist/order.js',
      'packages/tree-ops/dist/collapse.js',
      'packages/tree-ops/dist/subset.js',
      'packages/tree-ops/dist/focus.js',
    ],
  },
  {
    name: 'tree-ops: autoCollapse only',
    code: `import { autoCollapse } from '@gbif-phylo/tree-ops'; console.log(autoCollapse);`,
    forbid: [
      'packages/tree-ops/dist/rooting.js',
      'packages/tree-ops/dist/order.js',
      'packages/tree-ops/dist/collapse.js',
      'packages/tree-ops/dist/subset.js',
      'packages/tree-ops/dist/focus.js',
      'packages/tree-ops/dist/follow.js',
      'packages/tree-ops/dist/bytes.js',
    ],
  },
  {
    name: 'viewer: TreeViewer',
    code: `import { TreeViewer } from '@gbif-phylo/viewer'; console.log(TreeViewer);`,
    forbid: [
      'node_modules/react',
      'packages/io/',
      'packages/viewer/dist/colour-by.js',
      'packages/viewer/dist/controls/',
      'packages/viewer/dist/overlays/',
      'packages/viewer/dist/overview.js',
    ],
  },
  {
    name: 'viewer: TreeViewer + Zoom',
    code: `import { TreeViewer, Zoom } from '@gbif-phylo/viewer'; console.log(TreeViewer, Zoom);`,
    forbid: ['packages/viewer/dist/overview.js', 'controls/search.js', 'controls/legend.js', 'controls/defaults.js'],
  },
  {
    name: 'viewer: TreeViewer + defaultControls',
    code: `import { TreeViewer, defaultControls } from '@gbif-phylo/viewer'; console.log(TreeViewer, defaultControls);`,
    forbid: [],
  },
  {
    // React is external here (a peer dependency); what matters is that the default controls (zoom, fit) do not pull in the others
    name: 'react: TreeView',
    code: `import { TreeView } from '@gbif-phylo/react'; console.log(TreeView);`,
    forbid: ['controls/search.js', 'controls/legend.js', 'controls/defaults.js', 'controls/layout-toggle.js', 'packages/viewer/dist/overview.js'],
    external: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  {
    // the hooks build on the viewer's events only: no <TreeView>, no controls
    name: 'react: hooks only',
    code: `import { useTreeViewer, useViewport, useTreeEvent, useTreeTheme } from '@gbif-phylo/react'; console.log(useTreeViewer, useViewport, useTreeEvent, useTreeTheme);`,
    forbid: [
      'packages/react/dist/TreeView.js',
      'packages/viewer/dist/viewer.js',
      'packages/viewer/dist/controls/',
      'packages/viewer/dist/overview.js',
    ],
    external: ['react', 'react-dom', 'react/jsx-runtime'],
  },
];
for (const s of SCENARIOS) {
  const r = await esbuild.build({
    stdin: { contents: s.code, resolveDir: root, loader: 'js' },
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    metafile: true,
    external: s.external ?? [],
    logLevel: 'silent',
  });
  const out = r.outputFiles[0].contents;
  // the modules that contribute code to the output (esbuild's metafile.inputs also lists modules it parsed and then shook out entirely)
  const contributed = Object.values(r.metafile.outputs)[0].inputs;
  const inputs = Object.keys(contributed)
    .filter((p) => contributed[p].bytesInOutput > 0)
    .map((p) => path.relative(root, path.resolve(root, p)));
  const bad = inputs.filter((p) => s.forbid.some((f) => p.includes(f)));
  const gz = zlib.gzipSync(out, { level: 9 }).length;
  ok(
    bad.length === 0,
    `${s.name}: ${inputs.length} modules, ${(out.length / 1024).toFixed(1)} kB min, ${(gz / 1024).toFixed(1)} kB gzip${bad.length ? '; must not contain ' + bad.join(', ') : ''}`,
  );
  report.push({ name: s.name, modules: inputs.length, minBytes: out.length, gzipBytes: gz });
}
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(report, null, 2) + '\n');
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
