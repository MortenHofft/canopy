// "Every triangle can be drawn from overview rows alone": for EVERY row of overview.parquet (all levels) compare the numbers a
// triangle needs against what the renderer's own computeLayout() (spikes/custom/src/core/layout.ts, imported read-only) derives
// from the full tree: leaf range, X (distance from root, 0..1), XMAX (right edge of the clade), ROW (layout y), and the cladogram
// case (trees without lengths) where X comes from depth / max_depth.
//   node test/overview_vs_layout.mjs TREE.nwk[.gz] LAYOUT_DIR
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { asyncBufferFromFile, parquetMetadata, parquetRead } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(process.env.TMPDIR ?? '/tmp', 'pq-exp-bundle.mjs');
await build({ stdin: { contents: "export { parseNewick } from '../../shared/newick.ts'; export { computeLayout } from '../../custom/src/core/layout.ts';", resolveDir: here, sourcefile: 'x.ts', loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: tmp, logLevel: 'error' });
const { parseNewick, computeLayout } = await import(tmp);
const [treeFile, dir] = process.argv.slice(2);
const raw = fs.readFileSync(treeFile);
const tree = parseNewick((treeFile.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8'));
const L = computeLayout(tree, true);
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const file = await asyncBufferFromFile(path.join(dir, 'overview.parquet'));
const md = parquetMetadata(await file.slice(0, file.byteLength));
const chunks = [];
await parquetRead({ file, metadata: md, compressors, onChunk: (c) => chunks.push(c) });
const col = {};
for (const name of new Set(chunks.map((c) => c.columnName))) {
  const cs = chunks.filter((c) => c.columnName === name).sort((a, b) => a.rowStart - b.rowStart);
  const n = cs.reduce((a, c) => a + c.columnData.length, 0);
  const out = new Float64Array(n); let o = 0;
  for (const c of cs) { for (let i = 0; i < c.columnData.length; i++) out[o + i] = Number(c.columnData[i]); o += c.columnData.length; }
  col[name] = out;
}
const n = col.node.length;
const lengths = man.has_lengths;
const rootMax = man.max_cum;      // maxLen of computeLayout (clamped cumulative lengths): the normaliser
const H = man.max_depth || 1;
let bad = 0, worst = { X: 0, XMAX: 0, ROW: 0 };
const tol = 2e-6;
for (let k = 0; k < n; k++) {
  const i = col.node[k];
  const isTip = tree.childCount[i] === 0;
  const X = lengths ? col.cum_len[k] / rootMax : (isTip ? 1 : 1 - (col.max_depth[k] - col.depth[k]) / H);
  const XMAX = lengths ? col.max_cum[k] / rootMax : 1;
  const errs = [];
  if (col.leaf_start[k] !== tree.leafStart[i] || col.tip_count[k] !== tree.leafEnd[i] - tree.leafStart[i]) errs.push('leaf range');
  if (col.subtree_end[k] !== tree.subtreeEnd[i] || col.parent[k] !== tree.parent[i]) errs.push('structure');
  const dX = Math.abs(X - L.X[i]), dM = Math.abs(XMAX - L.XMAX[i]), dR = Math.abs(col.row[k] - L.ROW[i]);
  worst.X = Math.max(worst.X, dX); worst.XMAX = Math.max(worst.XMAX, dM); worst.ROW = Math.max(worst.ROW, dR);
  if (dX > tol) errs.push('X ' + X + ' vs ' + L.X[i]);
  if (dM > tol) errs.push('XMAX ' + XMAX + ' vs ' + L.XMAX[i]);
  if (dR > 0.001) errs.push('ROW ' + col.row[k] + ' vs ' + L.ROW[i]);
  if (errs.length && bad++ < 5) console.log('MISMATCH node', i, errs.join('; '));
}
console.log(`${bad === 0 ? 'PASS' : 'FAIL'} overview rows=${n} (levels ${man.overview.level_rows.join('+')}) mode=${lengths ? 'phylogram' : 'cladogram'} mismatches=${bad} worst |dX|=${worst.X.toExponential(2)} |dXMAX|=${worst.XMAX.toExponential(2)} |dROW|=${worst.ROW.toExponential(2)}`);
process.exit(bad ? 1 : 0);
