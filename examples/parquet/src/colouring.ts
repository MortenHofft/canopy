// Colouring a partially loaded tree by one category column of the sidecar. The whole column is read once (one value per tip, as codes) and
// turned into a colour class per tip rank; whenever the snapshot changes (rows arrived), `cladesFor` turns it into the `setClades` list for
// the rows that are in the snapshot, so the cost follows what is loaded, not the size of the tree:
//   - a clade whose tips all have one class is one entry (its branches, and its summary when the level of detail draws one, take the colour);
//   - a stub (a clade whose rows are not loaded, drawn as a triangle) takes the class most of its tips have, even when they are mixed;
//   - a tip in a mixed clade is one entry.
// "All the tips of a clade have one class" is O(1): `runEnd[r]` is where the run of equal classes that starts at rank r ends.

import type { CladeColour, LegendItem, TreeSnapshot } from '@gbif-phylo/viewer';
import type { Dataset } from './dataset.ts';

export interface Colouring {
  key: string;
  /** Colour class by tip rank: 0..palette.length-1 are the most frequent values, palette.length is 'Other', -1 has no value. */
  cls: Int16Array;
  /** For rank r: the end (exclusive) of the run of tips from r that have the same class. */
  runEnd: Int32Array;
  /** The colour of each class; the last is 'Other'. */
  colours: string[];
  items: LegendItem[];
  coloured: number;
}

const tips = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'tip' : 'tips'}`;

/** Read the column `key` for all tips and classify it. `palette` colours the most frequent values in turn, `other` the rest. */
export async function loadColouring(ds: Dataset, key: string, palette: readonly string[], other: string): Promise<Colouring> {
  const col = ds.sidecarColumns.find((c) => c.name === key);
  if (!col || col.kind !== 'category') throw new Error(`${key} is not a category column`);
  const codes = await ds.categoryColumn(key);
  const counts = col.counts!;
  const order = counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b);
  const classOfValue = new Int16Array(counts.length);
  order.forEach((v, rank) => (classOfValue[v] = Math.min(rank, palette.length)));
  const n = codes.length;
  const cls = new Int16Array(n);
  let coloured = 0;
  for (let r = 0; r < n; r++) {
    cls[r] = codes[r] < 0 ? -1 : classOfValue[codes[r]];
    if (cls[r] >= 0) coloured++;
  }
  const runEnd = new Int32Array(n);
  runEnd[n - 1] = n;
  for (let r = n - 2; r >= 0; r--) runEnd[r] = cls[r] === cls[r + 1] ? runEnd[r + 1] : r + 1;
  const colours = [...palette, other];
  const items: LegendItem[] = [];
  let rest = 0;
  order.forEach((v, rank) => {
    if (rank < palette.length) items.push({ colour: colours[rank], label: col.values![v], detail: tips(counts[v]) });
    else rest += counts[v];
  });
  if (rest) items.push({ colour: other, label: 'Other', detail: `${tips(rest)}, ${order.length - palette.length} values` });
  return { key, cls, runEnd, colours, items, coloured };
}

/** The clade colours for the rows of `s`: see the top of the file. Node ids are the preorder ids of the full tree (`globalId`). */
export function cladesFor(s: TreeSnapshot, c: Colouring): CladeColour[] {
  const n = s.nodeCount;
  const gid = s.globalId!;
  const stub = s.stub!;
  const K = c.colours.length;
  const uni = new Int16Array(n); // the class every tip below the row has, -1 none, -2 mixed
  for (let i = 0; i < n; i++) {
    const a = s.leafStart[i];
    uni[i] = c.runEnd[a] >= s.leafEnd[i] ? c.cls[a] : -2;
  }
  const out: CladeColour[] = [];
  const hist = new Int32Array(K);
  for (let i = 0; i < n; i++) {
    if (i > 0 && uni[s.parent[i]] >= 0) continue; // inside a clade that is already one colour
    let k = uni[i];
    if (k === -2 && stub[i] === 1) {
      hist.fill(0);
      for (let r = s.leafStart[i], e = s.leafEnd[i]; r < e; r++) if (c.cls[r] >= 0) hist[c.cls[r]]++;
      k = -1;
      let best = 0;
      for (let q = 0; q < K; q++) if (hist[q] > best) [best, k] = [hist[q], q];
    }
    if (k >= 0) out.push({ node: gid[i], colour: c.colours[k] });
  }
  return out;
}
