// Layout for the stub: node coordinates in "tree units". Iterative; uses only TreeModel arrays.
// Rectangular: x in [0,1000] (root to tip), y in row units (tip of rank r sits at r + 0.5).
// Radial: both in [-1000,1000]; angle = 2*pi*row/tipCount, radius = x.

import type { TreeModel } from '../../shared/tree.ts';
import type { Layout } from '../../shared/types.ts';

export const SPAN = 1000;

export interface Geometry {
  layout: Layout;
  X: Float64Array; // drawn x of each node (tree units)
  Y: Float64Array; // drawn y of each node
  v: Float64Array; // normalised root-to-node distance 0..1
  row: Float64Array; // row coordinate (tip rank + 0.5; internal: mean of first and last child)
  usedLengths: boolean; // false when the tree has no lengths or the cladogram was requested
  layoutMs: number;
}

export function computeGeometry(tree: TreeModel, layout: Layout, branchLengths: boolean): Geometry {
  const t0 = performance.now();
  const n = tree.nodeCount;
  const v = new Float64Array(n);
  const useLen = branchLengths && tree.hasLengths && tree.maxCumLength > 0;
  if (useLen) {
    const m = tree.maxCumLength;
    for (let i = 0; i < n; i++) v[i] = Math.max(0, tree.cumLength[i]) / m; // negative cumulative lengths are clamped to 0
  } else {
    // cladogram: tips aligned on the right, x grows with the number of nodes between root and the deepest tip below
    const h = tree.heights();
    const H = h[0] || 1;
    for (let i = 0; i < n; i++) v[i] = tree.childCount[i] === 0 ? 1 : 1 - h[i] / H;
  }
  const row = new Float64Array(n);
  for (let r = 0; r < tree.tipCount; r++) row[tree.tipNode[r]] = r + 0.5;
  for (let i = n - 1; i >= 0; i--) {
    if (tree.childCount[i] === 0) continue;
    const first = tree.firstChild[i];
    let last = first;
    for (let c = first; c >= 0; c = tree.nextSibling[c]) last = c;
    row[i] = (row[first] + row[last]) / 2;
  }
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  if (layout === 'rectangular') {
    for (let i = 0; i < n; i++) {
      X[i] = v[i] * SPAN;
      Y[i] = row[i];
    }
  } else {
    const k = (2 * Math.PI) / Math.max(1, tree.tipCount);
    for (let i = 0; i < n; i++) {
      const a = row[i] * k;
      X[i] = Math.cos(a) * v[i] * SPAN;
      Y[i] = Math.sin(a) * v[i] * SPAN;
    }
  }
  return { layout, X, Y, v, row, usedLengths: useLen, layoutMs: performance.now() - t0 };
}

const f = (x: number) => (Math.round(x * 100) / 100).toString();

export interface SvgParts {
  branchD: string[]; // path data of the branch to node i, at index i - 1
  dotD: string[]; // path data of the dot of node i
  /** Visible, combined paths: one for all branches, one for internal dots, one for tip dots. */
  visible: string;
  /** Transparent per-node hit targets (pointer-events: stroke), so clicks still reach single nodes and branches. */
  hitBranches: string;
  hitDots: string;
}

/**
 * SVG markup. Painting thousands of separate stroked paths is very slow in software rendering, so what is
 * drawn is three combined paths, and what is clicked is a layer of transparent per-node paths on top.
 */
export function buildSvg(tree: TreeModel, g: Geometry): SvgParts {
  const n = tree.nodeCount;
  const branchD: string[] = new Array(n > 0 ? n - 1 : 0);
  const dotD: string[] = new Array(n);
  const hb: string[] = new Array(n > 0 ? n - 1 : 0);
  const hd: string[] = new Array(n);
  const tipD: string[] = [];
  const intD: string[] = [];
  const rect = g.layout === 'rectangular';
  const a = (2 * Math.PI) / Math.max(1, tree.tipCount);
  for (let i = 0; i < n; i++) {
    const tip = tree.childCount[i] === 0;
    const dd = `M${f(g.X[i])},${f(g.Y[i])}h.01`;
    dotD[i] = dd;
    (tip ? tipD : intD).push(dd);
    hd[i] = `<path class="d ${tip ? 't' : 'i'}" data-n="${i}" d="${dd}"/>`;
    if (i === 0) continue;
    const p = tree.parent[i];
    let d: string;
    if (rect) {
      d = `M${f(g.X[p])},${f(g.Y[p])}V${f(g.Y[i])}H${f(g.X[i])}`;
    } else {
      const rp = g.v[p] * SPAN;
      const ang = g.row[i] * a;
      const dA = (g.row[i] - g.row[p]) * a;
      d = `M${f(g.X[p])},${f(g.Y[p])}A${f(rp)},${f(rp)} 0 ${Math.abs(dA) > Math.PI ? 1 : 0} ${dA >= 0 ? 1 : 0} ${f(Math.cos(ang) * rp)},${f(Math.sin(ang) * rp)}L${f(g.X[i])},${f(g.Y[i])}`;
    }
    branchD[i - 1] = d;
    hb[i - 1] = `<path class="b" data-n="${i}" d="${d}"/>`;
  }
  return {
    branchD,
    dotD,
    visible: `<path class="vb" d="${branchD.join('')}"/><path class="vi" d="${intD.join('')}"/><path class="vt" d="${tipD.join('')}"/>`,
    hitBranches: hb.join(''),
    hitDots: hd.join(''),
  };
}
