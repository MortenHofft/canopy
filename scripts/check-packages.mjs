// Package checks, run after `npm run build`:
//  1. publint on every published package (errors and warnings fail; suggestions are printed);
//  2. `npm pack --dry-run`: the tarball holds dist/ (JS, declarations, maps), src/, README and LICENSE, and nothing else of note;
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
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' }));
  const files = packed.files.map((f) => f.path);
  const unexpected = files.filter((f) => !/^(dist\/|src\/|README\.md$|LICENSE$|package\.json$)/.test(f));
  ok(
    unexpected.length === 0,
    `tarball holds only dist/, src/, README, LICENSE, package.json${unexpected.length ? ': also ' + unexpected.join(', ') : ''}`,
  );
  ok(files.includes('dist/index.d.ts') && files.some((f) => f.endsWith('.js.map')), 'tarball has declarations and source maps');
  console.log(`  ${files.length} files, ${(packed.size / 1024).toFixed(1)} kB packed, ${(packed.unpackedSize / 1024).toFixed(1)} kB unpacked`);
}

// ---- 3: tree shaking. `forbid` are substrings of bundled input paths (relative to the repository) that must be absent.
const SCENARIOS = [
  { name: 'io: parseNewick only', code: `import { parseNewick } from '@gbif-phylo/io'; console.log(parseNewick('(a,b);'));`, forbid: [] },
  {
    name: 'tree-ops: ladderise only',
    code: `import { ladderise } from '@gbif-phylo/tree-ops'; console.log(ladderise);`,
    forbid: ['packages/tree-ops/dist/rooting.js', 'packages/tree-ops/dist/collapse.js', 'packages/tree-ops/dist/subset.js'],
  },
  {
    name: 'viewer: TreeViewer',
    code: `import { TreeViewer } from '@gbif-phylo/viewer'; console.log(TreeViewer);`,
    forbid: ['node_modules/react', 'packages/io/', 'packages/viewer/dist/controls/', 'packages/viewer/dist/overview.js'],
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
    name: 'react: TreeView',
    code: `import { TreeView } from '@gbif-phylo/react'; console.log(TreeView);`,
    forbid: ['node_modules/react'],
    external: ['react', 'react-dom', 'react/jsx-runtime'],
  },
];
const report = [];
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
