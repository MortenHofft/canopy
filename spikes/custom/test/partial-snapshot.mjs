// Test helper (not a test): a partially loaded snapshot, built from a complete tree in memory the way src/parquet/ParquetSource.ts build()
// does it, in miniature. The clades named in `stubIds` (full-tree preorder ids of internal nodes) are not loaded: they are one stub row each,
// with childCount 1, subtreeEnd = row + 1 and their rollups. Everything else is a row. `idOffset` shifts the global ids to catch code that
// confuses a row with a full-tree id.
//
// Returns { snap, full, rowOf } where snap is a TreeSnapshot (stub, globalId, rollup, toLocal set; tipNode -1 for tips that are not
// loaded; `labels` and `tipLabels` are blank, as ParquetSource.build() leaves them, so a core read of labels on a partial snapshot shows up)
// and rowOf(g) the row of full-tree id g (-1 when it is below a stub).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { computeLayout } = await import(path.join(root, 'spikes/custom/src/core/layout.ts'));

export function partialSnapshot(full, stubIds = [], idOffset = 0) {
  const stubSet = new Set(stubIds);
  const rows = [];
  for (let g = 0; g < full.nodeCount;) {
    rows.push(g);
    if (stubSet.has(g) && full.childCount[g] > 0) g = full.subtreeEnd[g];
    else g++;
  }
  const n = rows.length;
  const rowByG = new Map(rows.map((g, r) => [g, r]));
  // rollups of the FULL tree, as the overview / clade files carry them
  const N = full.nodeCount;
  const cumAll = new Float64Array(N),
    depthAll = new Int32Array(N),
    maxCumAll = new Float64Array(N),
    maxDepthAll = new Int32Array(N);
  for (let i = 1; i < N; i++) {
    const l = full.length[i];
    cumAll[i] = cumAll[full.parent[i]] + (l > 0 ? l : 0);
    depthAll[i] = depthAll[full.parent[i]] + 1;
  }
  for (let i = 0; i < N; i++) {
    maxCumAll[i] = cumAll[i];
    maxDepthAll[i] = depthAll[i];
  }
  for (let i = N - 1; i > 0; i--) {
    const p = full.parent[i];
    if (maxCumAll[i] > maxCumAll[p]) maxCumAll[p] = maxCumAll[i];
    if (maxDepthAll[i] > maxDepthAll[p]) maxDepthAll[p] = maxDepthAll[i];
  }
  const gid = Int32Array.from(rows, (g) => g + idOffset);
  const stub = Uint8Array.from(rows, (g) => (stubSet.has(g) && full.childCount[g] > 0 ? 1 : 0));
  const parent = new Int32Array(n),
    firstChild = new Int32Array(n).fill(-1),
    nextSibling = new Int32Array(n).fill(-1),
    childCount = new Int32Array(n),
    lastChild = new Int32Array(n).fill(-1);
  for (let r = 1; r < n; r++) {
    const p = rowByG.get(full.parent[rows[r]]);
    parent[r] = p;
    childCount[p]++;
    if (lastChild[p] < 0) firstChild[p] = r;
    else nextSibling[lastChild[p]] = r;
    lastChild[p] = r;
  }
  const subtreeEnd = new Int32Array(n);
  for (let r = n - 1; r >= 0; r--) subtreeEnd[r] = lastChild[r] >= 0 ? subtreeEnd[lastChild[r]] : r + 1;
  for (let r = 0; r < n; r++) if (stub[r]) childCount[r] = 1; // internal, so not taken for a tip
  const tipNode = new Int32Array(full.tipCount).fill(-1),
    tipRank = new Int32Array(n).fill(-1);
  const tipLabels = new Array(full.tipCount); // empty slots, as ParquetSource's noLabels
  for (let r = 0; r < n; r++) {
    const g = rows[r];
    if (full.childCount[g] === 0) {
      tipNode[full.leafStart[g]] = r;
      tipRank[r] = full.leafStart[g];
    }
  }
  // a stub's row is its row in the layout of the FULL tree (the overview files carry it); the loaded rows above it are derived from it
  const row = new Float64Array(n);
  const fullRow = computeLayout(full, true).ROW;
  for (let r = 0; r < n; r++) if (tipRank[r] >= 0) row[r] = tipRank[r] + 0.5;
  for (let r = 0; r < n; r++) if (stub[r]) row[r] = fullRow[rows[r]];
  for (let r = n - 1; r >= 0; r--) if (lastChild[r] >= 0 && !stub[r]) row[r] = (row[firstChild[r]] + row[lastChild[r]]) / 2;
  const snap = {
    nodeCount: n,
    tipCount: full.tipCount,
    parent,
    firstChild,
    nextSibling,
    childCount,
    subtreeEnd,
    length: Float64Array.from(rows, (g) => full.length[g]),
    leafStart: Int32Array.from(rows, (g) => full.leafStart[g]),
    leafEnd: Int32Array.from(rows, (g) => full.leafEnd[g]),
    tipNode,
    tipRank,
    tipLabels,
    labels: new Array(n),
    hasLengths: full.hasLengths,
    heights: () => Int32Array.from(rows, (_, r) => snap.rollup.maxDepth[r] - snap.rollup.depth[r]),
    tipIndex: () => -1,
    stub,
    globalId: gid,
    rollup: {
      cumLength: Float64Array.from(rows, (g) => cumAll[g]),
      maxCum: Float64Array.from(rows, (g) => maxCumAll[g]),
      depth: Int32Array.from(rows, (g) => depthAll[g]),
      maxDepth: Int32Array.from(rows, (g) => maxDepthAll[g]),
      row,
    },
    toLocal: (g) => {
      const r = rowByG.get(g - idOffset);
      return r === undefined ? -1 : r;
    },
  };
  return { snap, full, rowOf: (g) => rowByG.get(g) ?? -1 };
}
