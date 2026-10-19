// Conversion between the shared TreeModel and what Taxonium accepts, plus a replica of Taxonium's own layout.
//
// Taxonium has no object API for a tree: it takes a FILE (Newick text, Nexus text, Taxonium jsonl, Nextstrain JSON)
// and an optional metadata CSV/TSV, parses and lays it out in a Web Worker, and gives node ids that are indexes into
// its own y-sorted node array. So the adapter
//   1. writes a Newick string from the TreeModel (iterative; internal nodes get the name 'n<preorder>' so a
//      selected node can be mapped back with certainty, tips keep their label unless it contains a character that the
//      library's parser cannot read: , ( ) : ; [ ] ' and control characters);
//   2. writes a tiny metadata TSV with one unique key per tip (column 'id'), which is the only way to colour tips
//      individually (Taxonium colours a node by the value of one of its fields);
//   3. replicates the library's layout (kn_calxy in utils/jstree.js plus the x scaling in utils/processNewick.ts of
//      taxonium-component 2.1.24) to get node coordinates for locate()/bounds()/focus. The replica is verified in
//      scripts/probe.mjs against what deck.gl really picks at the computed screen position.
// No recursion anywhere.

import type { TreeModel } from '../../shared/tree.ts';

const UNSAFE = /[,():;\[\]'"\s]/g;

export interface TaxInput {
  newick: string;
  tsv: string;
  /** library tip name -> real tip id, only for tips whose label had to be changed */
  renamed: Map<string, string>;
  /** real tip id -> library tip name (identity unless renamed) */
  libName(tip: string): string;
  ms: number;
}

export function buildInput(tree: TreeModel, withLengths: boolean): TaxInput {
  const t0 = performance.now();
  const n = tree.nodeCount;
  const renamed = new Map<string, string>();
  const used = new Set<string>();
  const toLib = new Map<string, string>();
  const tipName = new Array<string>(tree.tipCount);
  for (let r = 0; r < tree.tipCount; r++) {
    const label = tree.tipLabels[r];
    let name = label;
    if (UNSAFE.test(label) || label === '') {
      UNSAFE.lastIndex = 0;
      name = label.replace(UNSAFE, '_') || '_';
    }
    UNSAFE.lastIndex = 0;
    if (name !== label || used.has(name)) {
      let cand = name;
      let k = 1;
      while (used.has(cand)) cand = `${name}~${k++}`;
      name = cand;
    }
    used.add(name);
    if (name !== label) {
      renamed.set(name, label);
      toLib.set(label, name);
    }
    tipName[r] = name;
  }
  // Newick, iterative. stack holds open internal nodes.
  const out: string[] = [];
  const stack: number[] = [];
  const len = (i: number) => (withLengths && i > 0 && Number.isFinite(tree.length[i]) ? ':' + tree.length[i] : '');
  const closeUntil = (i: number) => {
    while (stack.length && tree.subtreeEnd[stack[stack.length - 1]] <= i) {
      const top = stack.pop()!;
      out.push(')n' + top + len(top));
    }
  };
  for (let i = 0; i < n; i++) {
    closeUntil(i);
    if (i > 0 && out[out.length - 1] !== '(') out.push(',');
    if (tree.childCount[i] > 0) {
      out.push('(');
      stack.push(i);
    } else {
      out.push(tipName[tree.tipRank[i]] + len(i));
    }
  }
  closeUntil(n + 1);
  out.push(';');
  const newick = out.join('');
  // metadata: key column 'name' (join key = node name), data column 'id' (same string; unique per tip)
  const rows: string[] = ['name\tid'];
  for (let r = 0; r < tree.tipCount; r++) rows.push(tipName[r] + '\t' + tipName[r]);
  const tsv = rows.join('\n');
  return { newick, tsv, renamed, libName: (tip) => toLib.get(tip) ?? tip, ms: performance.now() - t0 };
}

export interface Geometry {
  X: Float64Array; // Taxonium x_dist (after its 450/ref scaling)
  Y: Float64Array; // Taxonium y (0..2000)
  minX: number;
  maxX: number;
  usedLengths: boolean;
}

/** Replica of Taxonium 2.1.24's layout for a Newick file read with useDistances=true. */
export function taxoniumLayout(tree: TreeModel, withLengths: boolean): Geometry {
  const n = tree.nodeCount;
  const Y = new Float64Array(n);
  const scaleN = Math.max(1, tree.tipCount - 1);
  const lastChild = new Int32Array(n).fill(-1);
  for (let i = 1; i < n; i++) lastChild[tree.parent[i]] = i; // preorder: the last assignment is the last child
  for (let i = n - 1; i >= 0; i--) {
    if (tree.childCount[i] === 0) Y[i] = (tree.tipRank[i] / scaleN) * 2000;
    else Y[i] = (Y[tree.firstChild[i]] + Y[lastChild[i]]) / 2.0; // kn_calxy: mean of first and last child
  }
  const X = new Float64Array(n);
  let usedLengths = false;
  if (withLengths) {
    let scale = 0;
    for (let i = 1; i < n; i++) {
      const l = tree.length[i];
      X[i] = X[tree.parent[i]] + (l === l && l >= 0 ? l : 0);
      if (X[i] > scale) scale = X[i];
    }
    if (scale > 0) {
      usedLengths = true;
      for (let i = 0; i < n; i++) X[i] /= scale;
    }
  }
  if (!usedLengths) {
    X.fill(0);
    X[0] = 1;
    let scale = 1;
    for (let i = 1; i < n; i++) {
      X[i] = X[tree.parent[i]] + 1;
      if (X[i] > scale) scale = X[i];
    }
    for (let i = 1; i < n; i++) if (tree.childCount[i] === 0) X[i] = scale;
    for (let i = 0; i < n; i++) X[i] /= scale;
  }
  // x scaling in cleanup(): 99th percentile of the normalised x -> 450
  const sorted = Float64Array.from(X).sort();
  const ref = sorted[Math.floor(sorted.length * 0.99)];
  const k = 450 / ref;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    X[i] *= k;
    if (X[i] < minX) minX = X[i];
    if (X[i] > maxX) maxX = X[i];
  }
  return { X, Y, minX, maxX, usedLengths };
}
