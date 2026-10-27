// The overview pyramid: levels of clades that are drawn from rows alone. Level L holds the clades expanded at level at most L plus the
// stubs of their children; a stub is an internal node whose rows are not in the level, drawn as a triangle from its rollups. The budget
// counts rows, clades are taken by tip count (largest first), and a clade whose children do not fit stays a stub with everything below it.
// (The rule of the research experiment, docs/results/parquet-experiment.md on the research branch, section 3, item 6.)

const BUDGETS = [2048, 8192, 32768, 131072]; // rows per level, cumulative

/** @param {number} budget  the first level's row budget; later ones are four times larger, kept while at most an eighth of all nodes */
export function budgetsFor(nodes, first = BUDGETS[0]) {
  const all = [first, first * 4, first * 16, first * 64];
  const b = all.filter((x) => x <= Math.floor(nodes / 8));
  return b.length ? b : [Math.max(8, Math.floor(nodes / 8))];
}

/** @returns {{ sel: Uint8Array, budgets: number[] }}  sel[i]: the level that expands node i (255: never) */
export function selectOverview(t, firstBudget) {
  const { n, tipCount, end, parent } = t;
  const cand = [];
  for (let i = 0; i < n; i++) if (end[i] !== i + 1) cand.push(i);
  const SH = 2 ** 26; // node ids below 2^26; tip counts below 2^25, so a key is exact in a double
  const keys = new Float64Array(cand.length);
  for (let k = 0; k < cand.length; k++) keys[k] = tipCount[cand[k]] * SH + (SH - 1 - cand[k]);
  keys.sort(); // ascending: walk from the end for tip count descending, node id ascending
  const order = new Int32Array(cand.length);
  for (let k = 0; k < cand.length; k++) order[k] = SH - 1 - (keys[cand.length - 1 - k] % SH);
  const nchild = new Int32Array(n);
  for (let i = 1; i < n; i++) nchild[parent[i]]++;
  const sel = new Uint8Array(n).fill(255);
  const expanded = new Uint8Array(n);
  const kept = [];
  let rowsNow = 1;
  let level = 0;
  for (const B of budgetsFor(n, firstBudget)) {
    let added = 0;
    for (let q = 0; q < order.length; q++) {
      const i = order[q];
      if (expanded[i]) continue;
      if (i !== 0 && !expanded[parent[i]]) continue;
      if (i !== 0 && rowsNow + nchild[i] > B) continue;
      expanded[i] = 1;
      sel[i] = level;
      added++;
      rowsNow += nchild[i];
      if (rowsNow >= B) break;
    }
    if (!added) continue;
    level++;
    kept.push(B);
  }
  return { sel, budgets: kept };
}

/** The node ids of each level's rows: the clades expanded there and the stubs of their children that no later level expands. Level L's
 *  rows are exactly what the level-L view needs; the deepest level is written first so that level 0 plus the footer is one tail. */
export function levelRows(t, sel, levels) {
  const { n, parent } = t;
  const out = [];
  for (let L = 0; L < levels; L++) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      if (sel[i] === L) rows.push(i);
      else if (i > 0 && sel[parent[i]] === L && sel[i] > L) rows.push(i);
    }
    out.push(Int32Array.from(rows));
  }
  return out;
}
